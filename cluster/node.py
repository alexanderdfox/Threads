#!/usr/bin/env python3
"""
GPU-Accelerated Cluster Worker Node
Executes computational jobs and reports back to coordinator
"""

import asyncio
import json
import logging
import time
import os
import sys
import subprocess
import psutil
import requests
from aiohttp import web, ClientSession
import aiohttp
from typing import Dict, Any, Optional
import threading
import queue
import signal

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger('cluster-node')

class ClusterNode:
    def __init__(self):
        self.node_id = os.getenv('NODE_ID', 'worker-1')
        self.node_type = os.getenv('NODE_TYPE', 'worker')
        self.coordinator_url = os.getenv('COORDINATOR_URL', 'http://coordinator:3000')
        self.gpu_enabled = self.detect_gpu_support()
        self.worker_threads = int(os.getenv('WORKER_THREADS', 4))
        self.port = 8080
        
        # Node capabilities
        self.capabilities = self.detect_capabilities()
        
        # Job execution state
        self.current_jobs = {}
        self.completed_jobs = 0
        self.total_execution_time = 0.0
        self.is_registered = False
        
        # Performance monitoring
        self.cpu_usage = 0.0
        self.memory_usage = 0.0
        self.gpu_usage = 0.0
        self.load_score = 0.0
        
        # Job queue
        self.job_queue = queue.Queue()
        self.result_queue = queue.Queue()
        
        logger.info(f"Worker Node {self.node_id} initialized - GPU: {self.gpu_enabled}")

    def detect_gpu_support(self) -> bool:
        """Detect if GPU acceleration is available"""
        gpu_env = os.getenv('GPU_ENABLED', 'auto').lower()
        
        if gpu_env == 'false':
            return False
        elif gpu_env == 'true':
            return True
        
        # Auto-detect GPU support
        try:
            # Check for NVIDIA GPU
            result = subprocess.run(['nvidia-smi'], capture_output=True, text=True, timeout=5)
            if result.returncode == 0:
                logger.info("NVIDIA GPU detected")
                return True
        except (subprocess.TimeoutExpired, FileNotFoundError):
            pass
        
        try:
            # Check for other GPU indicators
            if os.path.exists('/dev/dri') or os.path.exists('/proc/driver/nvidia'):
                logger.info("GPU hardware detected")
                return True
        except:
            pass
        
        logger.info("No GPU detected, using CPU mode")
        return False

    def detect_capabilities(self) -> list:
        """Detect node computational capabilities"""
        capabilities = ['thread_simulation', 'collatz_calculation']
        
        if self.gpu_enabled:
            capabilities.extend(['gpu_acceleration', 'parallel_processing'])
        
        capabilities.append(f'cpu_cores_{psutil.cpu_count()}')
        capabilities.append(f'memory_{psutil.virtual_memory().total // (1024**3)}GB')
        
        return capabilities

    async def register_with_coordinator(self):
        """Register this node with the cluster coordinator"""
        registration_data = {
            'node_id': self.node_id,
            'address': f'{self.node_id}:8080',
            'capabilities': self.capabilities,
            'gpu_enabled': self.gpu_enabled,
            'worker_threads': self.worker_threads,
            'node_type': self.node_type
        }
        
        try:
            async with ClientSession() as session:
                async with session.post(
                    f'{self.coordinator_url}/api/register',
                    json=registration_data,
                    timeout=aiohttp.ClientTimeout(total=10)
                ) as response:
                    if response.status == 200:
                        result = await response.json()
                        self.is_registered = True
                        logger.info(f"Successfully registered with coordinator: {result}")
                        return True
                    else:
                        logger.error(f"Registration failed with status {response.status}")
                        return False
        
        except Exception as e:
            logger.error(f"Failed to register with coordinator: {e}")
            return False

    async def send_heartbeat(self):
        """Send periodic heartbeat to coordinator"""
        while True:
            if self.is_registered:
                try:
                    heartbeat_data = {
                        'node_id': self.node_id,
                        'status': 'online',
                        'load_score': self.calculate_load_score(),
                        'jobs_active': len(self.current_jobs),
                        'jobs_completed': self.completed_jobs,
                        'cpu_usage': self.cpu_usage,
                        'memory_usage': self.memory_usage,
                        'gpu_usage': self.gpu_usage
                    }
                    
                    async with ClientSession() as session:
                        async with session.post(
                            f'{self.coordinator_url}/api/heartbeat',
                            json=heartbeat_data,
                            timeout=aiohttp.ClientTimeout(total=5)
                        ) as response:
                            if response.status != 200:
                                logger.warning(f"Heartbeat failed with status {response.status}")
                
                except Exception as e:
                    logger.error(f"Failed to send heartbeat: {e}")
            
            await asyncio.sleep(30)  # Send heartbeat every 30 seconds

    def calculate_load_score(self) -> float:
        """Calculate current node load score (lower is better)"""
        cpu_score = self.cpu_usage / 100.0
        memory_score = self.memory_usage / 100.0
        job_score = len(self.current_jobs) / max(self.worker_threads, 1)
        
        # GPU nodes get preference for GPU-enabled jobs
        gpu_bonus = -0.2 if self.gpu_enabled else 0.0
        
        return cpu_score + memory_score + job_score + gpu_bonus

    async def execute_job(self, request):
        """Execute a computational job"""
        try:
            job_data = await request.json()
            job_id = job_data['id']
            job_type = job_data['type']
            
            logger.info(f"Executing job {job_id} of type {job_type}")
            
            # Add job to current jobs
            self.current_jobs[job_id] = {
                'started_at': time.time(),
                'type': job_type,
                'status': 'running'
            }
            
            # Execute job based on type
            if job_type == 'thread':
                result = await self.execute_thread_job(job_data)
            elif job_type == 'collatz':
                result = await self.execute_collatz_job(job_data)
            else:
                raise ValueError(f"Unknown job type: {job_type}")
            
            # Update job completion stats
            execution_time = time.time() - self.current_jobs[job_id]['started_at']
            self.completed_jobs += 1
            self.total_execution_time += execution_time
            
            # Remove from current jobs
            del self.current_jobs[job_id]
            
            logger.info(f"Job {job_id} completed in {execution_time:.2f}s")
            
            return web.json_response({
                'job_id': job_id,
                'status': 'completed',
                'result': result,
                'execution_time': execution_time,
                'node_id': self.node_id
            })
        
        except Exception as e:
            logger.error(f"Job execution failed: {e}")
            if job_id in self.current_jobs:
                del self.current_jobs[job_id]
            
            return web.json_response({
                'job_id': job_data.get('id', 'unknown'),
                'status': 'failed',
                'error': str(e),
                'node_id': self.node_id
            }, status=500)

    async def execute_thread_job(self, job_data: Dict) -> Dict:
        """Execute thread simulation job"""
        parameters = job_data.get('parameters', {})
        thread_count = parameters.get('thread_count', 100)
        max_depth = parameters.get('max_depth', 5)
        batch_size = parameters.get('batch_size', 64 if self.gpu_enabled else 16)
        
        # Simulate thread processing
        start_time = time.time()
        results = []
        
        if self.gpu_enabled:
            # GPU-accelerated processing
            for batch_start in range(0, thread_count, batch_size):
                batch_end = min(batch_start + batch_size, thread_count)
                batch_results = await self.process_thread_batch_gpu(
                    list(range(batch_start, batch_end)), max_depth
                )
                results.extend(batch_results)
        else:
            # CPU multi-threaded processing
            results = await self.process_thread_batch_cpu(
                list(range(thread_count)), max_depth
            )
        
        execution_time = time.time() - start_time
        
        return {
            'type': 'thread_simulation',
            'threads_processed': len(results),
            'max_depth_reached': max(r.get('depth', 0) for r in results) if results else 0,
            'execution_time': execution_time,
            'acceleration': 'gpu' if self.gpu_enabled else 'cpu',
            'results': results[:10]  # Return sample results
        }

    async def execute_collatz_job(self, job_data: Dict) -> Dict:
        """Execute Collatz conjecture calculation job"""
        parameters = job_data.get('parameters', {})
        start_number = parameters.get('start_number', 1)
        number_count = parameters.get('number_count', 1000)
        batch_size = parameters.get('batch_size', 1024 if self.gpu_enabled else 64)
        
        numbers = list(range(start_number, start_number + number_count))
        
        start_time = time.time()
        results = []
        records = {'most_steps': {'number': 0, 'steps': 0}}
        
        if self.gpu_enabled:
            # GPU-accelerated Collatz calculations
            for batch_start in range(0, len(numbers), batch_size):
                batch_end = min(batch_start + batch_size, len(numbers))
                batch_numbers = numbers[batch_start:batch_end]
                batch_results = await self.calculate_collatz_batch_gpu(batch_numbers)
                results.extend(batch_results)
                
                # Update records
                for result in batch_results:
                    if result['steps'] > records['most_steps']['steps']:
                        records['most_steps'] = {'number': result['number'], 'steps': result['steps']}
        else:
            # CPU multi-threaded Collatz calculations
            results = await self.calculate_collatz_batch_cpu(numbers)
            
            # Update records
            for result in results:
                if result['steps'] > records['most_steps']['steps']:
                    records['most_steps'] = {'number': result['number'], 'steps': result['steps']}
        
        execution_time = time.time() - start_time
        
        return {
            'type': 'collatz_calculation',
            'numbers_processed': len(results),
            'execution_time': execution_time,
            'records': records,
            'acceleration': 'gpu' if self.gpu_enabled else 'cpu',
            'average_steps': sum(r['steps'] for r in results) / len(results) if results else 0,
            'results_sample': results[:10]  # Return sample results
        }

    async def process_thread_batch_gpu(self, thread_ids: list, max_depth: int) -> list:
        """Simulate GPU-accelerated thread processing"""
        # Simulate GPU processing time (much faster than CPU)
        await asyncio.sleep(0.01 * len(thread_ids) / 64)
        
        results = []
        for thread_id in thread_ids:
            # Simulate thread processing with mathematical operations
            result_value = thread_id
            depth = 0
            
            while depth < max_depth and result_value > 1:
                if result_value % 2 == 0:
                    result_value = result_value // 2
                else:
                    result_value = result_value * 3 + 1
                depth += 1
                
                if result_value > 1000000:
                    break
            
            results.append({
                'thread_id': thread_id,
                'final_value': result_value,
                'depth': depth,
                'processed_by': 'gpu'
            })
        
        return results

    async def process_thread_batch_cpu(self, thread_ids: list, max_depth: int) -> list:
        """CPU multi-threaded thread processing"""
        # Simulate CPU processing time
        await asyncio.sleep(0.05 * len(thread_ids) / self.worker_threads)
        
        results = []
        for thread_id in thread_ids:
            # Similar processing but slower
            result_value = thread_id
            depth = 0
            
            while depth < max_depth and result_value > 1:
                if result_value % 2 == 0:
                    result_value = result_value // 2
                else:
                    result_value = result_value * 3 + 1
                depth += 1
                
                if result_value > 1000000:
                    break
            
            results.append({
                'thread_id': thread_id,
                'final_value': result_value,
                'depth': depth,
                'processed_by': 'cpu'
            })
        
        return results

    async def calculate_collatz_batch_gpu(self, numbers: list) -> list:
        """GPU-accelerated Collatz calculations"""
        # Simulate GPU processing time
        await asyncio.sleep(0.002 * len(numbers) / 1024)
        
        results = []
        for number in numbers:
            current = number
            steps = 0
            max_value = number
            
            while current != 1 and steps < 10000:
                if current % 2 == 0:
                    current = current // 2
                else:
                    current = current * 3 + 1
                steps += 1
                max_value = max(max_value, current)
                
                if current > 100000000:
                    break
            
            results.append({
                'number': number,
                'steps': steps,
                'max_value': max_value,
                'processed_by': 'gpu'
            })
        
        return results

    async def calculate_collatz_batch_cpu(self, numbers: list) -> list:
        """CPU multi-threaded Collatz calculations"""
        # Simulate CPU processing time
        await asyncio.sleep(0.01 * len(numbers) / self.worker_threads)
        
        results = []
        for number in numbers:
            current = number
            steps = 0
            max_value = number
            
            while current != 1 and steps < 10000:
                if current % 2 == 0:
                    current = current // 2
                else:
                    current = current * 3 + 1
                steps += 1
                max_value = max(max_value, current)
                
                if current > 100000000:
                    break
            
            results.append({
                'number': number,
                'steps': steps,
                'max_value': max_value,
                'processed_by': 'cpu'
            })
        
        return results

    async def get_node_status(self, request):
        """Get current node status"""
        return web.json_response({
            'node_id': self.node_id,
            'status': 'online',
            'gpu_enabled': self.gpu_enabled,
            'capabilities': self.capabilities,
            'current_jobs': len(self.current_jobs),
            'completed_jobs': self.completed_jobs,
            'average_execution_time': (
                self.total_execution_time / self.completed_jobs 
                if self.completed_jobs > 0 else 0.0
            ),
            'load_score': self.calculate_load_score(),
            'system_stats': {
                'cpu_usage': self.cpu_usage,
                'memory_usage': self.memory_usage,
                'gpu_usage': self.gpu_usage
            }
        })

    async def monitor_system_resources(self):
        """Monitor system resource usage"""
        while True:
            try:
                # CPU usage
                self.cpu_usage = psutil.cpu_percent(interval=1)
                
                # Memory usage
                memory = psutil.virtual_memory()
                self.memory_usage = memory.percent
                
                # GPU usage (if available)
                if self.gpu_enabled:
                    try:
                        result = subprocess.run(
                            ['nvidia-smi', '--query-gpu=utilization.gpu', '--format=csv,noheader,nounits'],
                            capture_output=True, text=True, timeout=5
                        )
                        if result.returncode == 0:
                            self.gpu_usage = float(result.stdout.strip().split('\n')[0])
                    except:
                        self.gpu_usage = 0.0
                
                # Update load score
                self.load_score = self.calculate_load_score()
                
                await asyncio.sleep(10)  # Update every 10 seconds
                
            except Exception as e:
                logger.error(f"Error monitoring system resources: {e}")
                await asyncio.sleep(30)

    def setup_routes(self, app):
        """Setup HTTP routes"""
        app.router.add_post('/api/execute', self.execute_job)
        app.router.add_get('/api/status', self.get_node_status)
        
        # Health check
        async def health_check(request):
            return web.json_response({
                'status': 'healthy',
                'node_id': self.node_id,
                'registered': self.is_registered
            })
        
        app.router.add_get('/health', health_check)

    async def start_background_tasks(self):
        """Start all background tasks"""
        asyncio.create_task(self.send_heartbeat())
        asyncio.create_task(self.monitor_system_resources())

    async def shutdown(self):
        """Graceful shutdown"""
        logger.info("Shutting down cluster node...")
        
        # Wait for current jobs to complete
        timeout = 30  # 30 seconds timeout
        start_time = time.time()
        
        while self.current_jobs and (time.time() - start_time) < timeout:
            logger.info(f"Waiting for {len(self.current_jobs)} jobs to complete...")
            await asyncio.sleep(1)
        
        if self.current_jobs:
            logger.warning(f"Shutting down with {len(self.current_jobs)} incomplete jobs")

def signal_handler(node):
    """Handle shutdown signals"""
    def handler(signum, frame):
        logger.info(f"Received signal {signum}")
        asyncio.create_task(node.shutdown())
        sys.exit(0)
    return handler

async def main():
    node = ClusterNode()
    
    # Setup signal handlers
    signal.signal(signal.SIGINT, signal_handler(node))
    signal.signal(signal.SIGTERM, signal_handler(node))
    
    # Register with coordinator
    max_retries = 10
    for attempt in range(max_retries):
        if await node.register_with_coordinator():
            break
        else:
            logger.warning(f"Registration attempt {attempt + 1}/{max_retries} failed, retrying in 5 seconds...")
            await asyncio.sleep(5)
    else:
        logger.error("Failed to register with coordinator after all attempts")
        sys.exit(1)
    
    # Create web application
    app = web.Application()
    node.setup_routes(app)
    
    # Start background tasks
    await node.start_background_tasks()
    
    # Start web server
    runner = web.AppRunner(app)
    await runner.setup()
    
    site = web.TCPSite(runner, '0.0.0.0', node.port)
    await site.start()
    
    logger.info(f"Cluster Node {node.node_id} running on port {node.port}")
    
    # Keep running
    try:
        while True:
            await asyncio.sleep(1)
    except KeyboardInterrupt:
        await node.shutdown()

if __name__ == '__main__':
    asyncio.run(main())
