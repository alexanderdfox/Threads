#!/usr/bin/env python3
"""
GPU-Accelerated Cluster Coordinator
Manages work distribution across multiple nodes for thread and Collatz calculations
"""

import asyncio
import json
import logging
import time
from datetime import datetime
from typing import Dict, List, Optional, Any
import aiohttp
from aiohttp import web, ClientSession
import websockets
import os
import signal
import sys

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger('cluster-coordinator')

class ClusterCoordinator:
    def __init__(self):
        self.nodes: Dict[str, Dict] = {}
        self.active_jobs: Dict[str, Dict] = {}
        self.completed_jobs: Dict[str, Dict] = {}
        self.websocket_clients: set = set()
        self.stats = {
            'total_calculations': 0,
            'gpu_calculations': 0,
            'cpu_calculations': 0,
            'start_time': time.time(),
            'nodes_online': 0,
            'average_response_time': 0.0
        }
        
        # Configuration
        self.cluster_size = int(os.getenv('CLUSTER_SIZE', 3))
        self.gpu_enabled = os.getenv('GPU_ENABLED', 'true').lower() == 'true'
        self.port = int(os.getenv('COORDINATOR_PORT', 3000))
        self.metrics_port = int(os.getenv('METRICS_PORT', 9090))
        
        # Work queues
        self.thread_queue = asyncio.Queue()
        self.collatz_queue = asyncio.Queue()
        self.priority_queue = asyncio.Queue()
        
        logger.info(f"Cluster Coordinator initialized - Target size: {self.cluster_size}")

    async def register_node(self, request):
        """Register a new worker node"""
        data = await request.json()
        node_id = data.get('node_id')
        node_info = {
            'id': node_id,
            'address': data.get('address'),
            'capabilities': data.get('capabilities', []),
            'gpu_enabled': data.get('gpu_enabled', False),
            'worker_threads': data.get('worker_threads', 1),
            'status': 'online',
            'last_heartbeat': time.time(),
            'jobs_completed': 0,
            'average_job_time': 0.0,
            'load_score': 0.0
        }
        
        self.nodes[node_id] = node_info
        self.stats['nodes_online'] = len([n for n in self.nodes.values() if n['status'] == 'online'])
        
        logger.info(f"Node {node_id} registered - GPU: {node_info['gpu_enabled']}, Threads: {node_info['worker_threads']}")
        
        # Broadcast node registration to WebSocket clients
        await self.broadcast_update({
            'type': 'node_registered',
            'node': node_info,
            'stats': self.stats
        })
        
        return web.json_response({'status': 'registered', 'node_id': node_id})

    async def heartbeat(self, request):
        """Handle node heartbeat"""
        data = await request.json()
        node_id = data.get('node_id')
        
        if node_id in self.nodes:
            self.nodes[node_id]['last_heartbeat'] = time.time()
            self.nodes[node_id]['status'] = 'online'
            self.nodes[node_id]['load_score'] = data.get('load_score', 0.0)
            
            return web.json_response({'status': 'acknowledged'})
        
        return web.json_response({'status': 'unknown_node'}, status=400)

    async def submit_job(self, request):
        """Submit a new computational job"""
        data = await request.json()
        job_id = f"job_{int(time.time() * 1000)}_{len(self.active_jobs)}"
        
        job = {
            'id': job_id,
            'type': data.get('type', 'thread'),  # 'thread' or 'collatz'
            'priority': data.get('priority', 'normal'),  # 'low', 'normal', 'high'
            'parameters': data.get('parameters', {}),
            'submitted_at': time.time(),
            'status': 'queued',
            'assigned_node': None,
            'gpu_preferred': data.get('gpu_preferred', True)
        }
        
        self.active_jobs[job_id] = job
        
        # Add to appropriate queue
        if job['priority'] == 'high':
            await self.priority_queue.put(job)
        elif job['type'] == 'collatz':
            await self.collatz_queue.put(job)
        else:
            await self.thread_queue.put(job)
        
        logger.info(f"Job {job_id} submitted - Type: {job['type']}, Priority: {job['priority']}")
        
        return web.json_response({
            'job_id': job_id,
            'status': 'queued',
            'estimated_wait_time': await self.estimate_wait_time(job)
        })

    async def estimate_wait_time(self, job: Dict) -> float:
        """Estimate job completion time based on current load"""
        available_nodes = [n for n in self.nodes.values() if n['status'] == 'online']
        
        if not available_nodes:
            return 300.0  # 5 minutes default
        
        # Consider GPU preference
        if job['gpu_preferred']:
            gpu_nodes = [n for n in available_nodes if n['gpu_enabled']]
            if gpu_nodes:
                avg_time = sum(n['average_job_time'] for n in gpu_nodes) / len(gpu_nodes)
                return max(avg_time, 10.0)
        
        avg_time = sum(n['average_job_time'] for n in available_nodes) / len(available_nodes)
        return max(avg_time, 30.0)

    async def assign_jobs(self):
        """Background task to assign jobs to available nodes"""
        while True:
            try:
                # Process priority queue first
                job = None
                try:
                    job = await asyncio.wait_for(self.priority_queue.get(), timeout=0.1)
                except asyncio.TimeoutError:
                    try:
                        job = await asyncio.wait_for(self.collatz_queue.get(), timeout=0.1)
                    except asyncio.TimeoutError:
                        try:
                            job = await asyncio.wait_for(self.thread_queue.get(), timeout=0.1)
                        except asyncio.TimeoutError:
                            await asyncio.sleep(1)
                            continue
                
                if job:
                    node = await self.select_best_node(job)
                    if node:
                        await self.assign_job_to_node(job, node)
                    else:
                        # No available nodes, put job back in queue
                        if job['priority'] == 'high':
                            await self.priority_queue.put(job)
                        elif job['type'] == 'collatz':
                            await self.collatz_queue.put(job)
                        else:
                            await self.thread_queue.put(job)
                        
                        await asyncio.sleep(5)  # Wait before retrying
                
            except Exception as e:
                logger.error(f"Error in job assignment: {e}")
                await asyncio.sleep(1)

    async def select_best_node(self, job: Dict) -> Optional[Dict]:
        """Select the best node for a given job"""
        available_nodes = [n for n in self.nodes.values() if n['status'] == 'online']
        
        if not available_nodes:
            return None
        
        # Filter by capabilities
        if job['gpu_preferred']:
            gpu_nodes = [n for n in available_nodes if n['gpu_enabled']]
            if gpu_nodes:
                available_nodes = gpu_nodes
        
        # Sort by load score (lower is better)
        available_nodes.sort(key=lambda n: n['load_score'])
        
        return available_nodes[0] if available_nodes else None

    async def assign_job_to_node(self, job: Dict, node: Dict):
        """Assign a specific job to a specific node"""
        job['assigned_node'] = node['id']
        job['status'] = 'assigned'
        job['assigned_at'] = time.time()
        
        try:
            async with ClientSession() as session:
                async with session.post(
                    f"http://{node['address']}/api/execute",
                    json=job,
                    timeout=aiohttp.ClientTimeout(total=300)
                ) as response:
                    if response.status == 200:
                        result = await response.json()
                        await self.handle_job_completion(job['id'], result)
                    else:
                        await self.handle_job_failure(job['id'], f"Node returned status {response.status}")
        
        except Exception as e:
            logger.error(f"Failed to assign job {job['id']} to node {node['id']}: {e}")
            await self.handle_job_failure(job['id'], str(e))

    async def handle_job_completion(self, job_id: str, result: Dict):
        """Handle successful job completion"""
        if job_id in self.active_jobs:
            job = self.active_jobs.pop(job_id)
            job['status'] = 'completed'
            job['completed_at'] = time.time()
            job['result'] = result
            job['execution_time'] = job['completed_at'] - job['assigned_at']
            
            self.completed_jobs[job_id] = job
            
            # Update node statistics
            node_id = job['assigned_node']
            if node_id in self.nodes:
                node = self.nodes[node_id]
                node['jobs_completed'] += 1
                node['average_job_time'] = (
                    (node['average_job_time'] * (node['jobs_completed'] - 1) + job['execution_time'])
                    / node['jobs_completed']
                )
            
            # Update global statistics
            self.stats['total_calculations'] += 1
            if job.get('gpu_preferred') and self.nodes[node_id]['gpu_enabled']:
                self.stats['gpu_calculations'] += 1
            else:
                self.stats['cpu_calculations'] += 1
            
            logger.info(f"Job {job_id} completed in {job['execution_time']:.2f}s")
            
            # Broadcast completion to WebSocket clients
            await self.broadcast_update({
                'type': 'job_completed',
                'job': job,
                'stats': self.stats
            })

    async def handle_job_failure(self, job_id: str, error: str):
        """Handle job failure"""
        if job_id in self.active_jobs:
            job = self.active_jobs[job_id]
            job['status'] = 'failed'
            job['error'] = error
            job['failed_at'] = time.time()
            
            logger.error(f"Job {job_id} failed: {error}")
            
            # Broadcast failure to WebSocket clients
            await self.broadcast_update({
                'type': 'job_failed',
                'job': job,
                'error': error
            })

    async def get_cluster_status(self, request):
        """Get current cluster status"""
        return web.json_response({
            'nodes': self.nodes,
            'stats': self.stats,
            'active_jobs': len(self.active_jobs),
            'completed_jobs': len(self.completed_jobs),
            'queue_sizes': {
                'priority': self.priority_queue.qsize(),
                'collatz': self.collatz_queue.qsize(),
                'thread': self.thread_queue.qsize()
            }
        })

    async def websocket_handler(self, request):
        """Handle WebSocket connections for real-time updates"""
        ws = web.WebSocketResponse()
        await ws.prepare(request)
        
        self.websocket_clients.add(ws)
        logger.info(f"WebSocket client connected - Total: {len(self.websocket_clients)}")
        
        try:
            # Send initial status
            await ws.send_str(json.dumps({
                'type': 'initial_status',
                'nodes': self.nodes,
                'stats': self.stats
            }))
            
            async for msg in ws:
                if msg.type == aiohttp.WSMsgType.TEXT:
                    try:
                        data = json.loads(msg.data)
                        # Handle client messages if needed
                    except json.JSONDecodeError:
                        pass
                elif msg.type == aiohttp.WSMsgType.ERROR:
                    logger.error(f'WebSocket error: {ws.exception()}')
        
        except Exception as e:
            logger.error(f"WebSocket error: {e}")
        
        finally:
            self.websocket_clients.discard(ws)
            logger.info(f"WebSocket client disconnected - Remaining: {len(self.websocket_clients)}")
        
        return ws

    async def broadcast_update(self, message: Dict):
        """Broadcast update to all connected WebSocket clients"""
        if not self.websocket_clients:
            return
        
        message_str = json.dumps(message)
        disconnected = set()
        
        for ws in self.websocket_clients:
            try:
                await ws.send_str(message_str)
            except Exception as e:
                logger.warning(f"Failed to send to WebSocket client: {e}")
                disconnected.add(ws)
        
        # Remove disconnected clients
        self.websocket_clients -= disconnected

    async def cleanup_old_jobs(self):
        """Background task to clean up old completed jobs"""
        while True:
            try:
                current_time = time.time()
                cutoff_time = current_time - 3600  # Keep jobs for 1 hour
                
                old_jobs = [
                    job_id for job_id, job in self.completed_jobs.items()
                    if job.get('completed_at', 0) < cutoff_time
                ]
                
                for job_id in old_jobs:
                    del self.completed_jobs[job_id]
                
                if old_jobs:
                    logger.info(f"Cleaned up {len(old_jobs)} old completed jobs")
                
                await asyncio.sleep(300)  # Run every 5 minutes
                
            except Exception as e:
                logger.error(f"Error in job cleanup: {e}")
                await asyncio.sleep(60)

    async def monitor_nodes(self):
        """Background task to monitor node health"""
        while True:
            try:
                current_time = time.time()
                timeout_threshold = 60  # 60 seconds
                
                for node_id, node in self.nodes.items():
                    if current_time - node['last_heartbeat'] > timeout_threshold:
                        if node['status'] == 'online':
                            node['status'] = 'offline'
                            logger.warning(f"Node {node_id} marked as offline")
                            
                            await self.broadcast_update({
                                'type': 'node_offline',
                                'node_id': node_id,
                                'stats': self.stats
                            })
                
                self.stats['nodes_online'] = len([n for n in self.nodes.values() if n['status'] == 'online'])
                await asyncio.sleep(30)  # Check every 30 seconds
                
            except Exception as e:
                logger.error(f"Error in node monitoring: {e}")
                await asyncio.sleep(60)

    def setup_routes(self, app):
        """Setup HTTP routes"""
        app.router.add_post('/api/register', self.register_node)
        app.router.add_post('/api/heartbeat', self.heartbeat)
        app.router.add_post('/api/submit', self.submit_job)
        app.router.add_get('/api/status', self.get_cluster_status)
        app.router.add_get('/ws', self.websocket_handler)
        
        # Health check
        async def health_check(request):
            return web.json_response({'status': 'healthy', 'nodes_online': self.stats['nodes_online']})
        
        app.router.add_get('/health', health_check)

    async def start_background_tasks(self):
        """Start all background tasks"""
        asyncio.create_task(self.assign_jobs())
        asyncio.create_task(self.cleanup_old_jobs())
        asyncio.create_task(self.monitor_nodes())

    async def shutdown(self):
        """Graceful shutdown"""
        logger.info("Shutting down cluster coordinator...")
        
        # Close all WebSocket connections
        for ws in list(self.websocket_clients):
            await ws.close()
        
        # Wait for any pending operations
        await asyncio.sleep(1)

def signal_handler(coordinator):
    """Handle shutdown signals"""
    def handler(signum, frame):
        logger.info(f"Received signal {signum}")
        asyncio.create_task(coordinator.shutdown())
        sys.exit(0)
    return handler

async def main():
    coordinator = ClusterCoordinator()
    
    # Setup signal handlers
    signal.signal(signal.SIGINT, signal_handler(coordinator))
    signal.signal(signal.SIGTERM, signal_handler(coordinator))
    
    # Create web application
    app = web.Application()
    coordinator.setup_routes(app)
    
    # Start background tasks
    await coordinator.start_background_tasks()
    
    # Start web server
    runner = web.AppRunner(app)
    await runner.setup()
    
    site = web.TCPSite(runner, '0.0.0.0', coordinator.port)
    await site.start()
    
    logger.info(f"Cluster Coordinator running on port {coordinator.port}")
    
    # Keep running
    try:
        while True:
            await asyncio.sleep(1)
    except KeyboardInterrupt:
        await coordinator.shutdown()

if __name__ == '__main__':
    asyncio.run(main())
