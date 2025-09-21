# 🚀 GPU-Accelerated Cluster Setup Guide

Complete guide for deploying and managing a distributed GPU-accelerated cluster for thread simulation and Collatz conjecture calculations.

## 📋 Overview

This cluster setup provides:
- **Distributed GPU Computing**: Multiple nodes with GPU acceleration
- **Automatic Load Balancing**: Intelligent job distribution based on node capabilities
- **High Availability**: Redundant services with health monitoring
- **Auto Scaling**: Dynamic scaling based on computational load
- **Real-time Monitoring**: Comprehensive metrics and alerting

## 🏗️ Architecture

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Load Balancer │    │   Coordinator   │    │   Monitoring    │
│     (Nginx)     │    │    (Python)     │    │  (Prometheus)   │
└─────────────────┘    └─────────────────┘    └─────────────────┘
         │                        │                        │
         └────────────────────────┼────────────────────────┘
                                  │
         ┌────────────────────────┼────────────────────────┐
         │                        │                        │
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│  GPU Worker 1   │    │  GPU Worker 2   │    │  CPU Worker 1   │
│  (Metal/WebGL)  │    │  (Metal/WebGL)  │    │ (Multi-thread)  │
└─────────────────┘    └─────────────────┘    └─────────────────┘
```

## 🛠️ Prerequisites

### System Requirements

#### For Docker Deployment
- **Docker**: 20.10+ with Docker Compose v2
- **System**: 8GB RAM, 4 CPU cores minimum
- **GPU Support**: NVIDIA Docker runtime (optional but recommended)
- **Storage**: 20GB free disk space

#### For Kubernetes Deployment
- **Kubernetes**: 1.20+ cluster with kubectl configured
- **Node Requirements**: 
  - Master: 4GB RAM, 2 CPU cores
  - Workers: 8GB RAM, 4 CPU cores each
- **GPU Support**: NVIDIA Device Plugin for Kubernetes
- **Storage**: Persistent volume support

### Software Dependencies

```bash
# Docker installation (Ubuntu/Debian)
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh
sudo usermod -aG docker $USER

# Docker Compose
sudo curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
sudo chmod +x /usr/local/bin/docker-compose

# NVIDIA Docker (for GPU support)
curl -s -L https://nvidia.github.io/nvidia-docker/gpgkey | sudo apt-key add -
distribution=$(. /etc/os-release;echo $ID$VERSION_ID)
curl -s -L https://nvidia.github.io/nvidia-docker/$distribution/nvidia-docker.list | sudo tee /etc/apt/sources.list.d/nvidia-docker.list
sudo apt-get update && sudo apt-get install -y nvidia-docker2
sudo systemctl restart docker
```

## 🚀 Quick Start

### 1. Clone and Setup

```bash
# Clone the repository
git clone <repository-url>
cd threads

# Make deployment script executable
chmod +x deploy-cluster.sh

# Check system compatibility
./deploy-cluster.sh help
```

### 2. Deploy with Docker (Recommended for Development)

```bash
# Deploy 3-node cluster (1 GPU, 2 CPU)
./deploy-cluster.sh docker 3 1

# Deploy 5-node cluster (2 GPU, 3 CPU)
./deploy-cluster.sh docker 5 2

# CPU-only cluster (no GPU required)
./deploy-cluster.sh docker 4 0
```

### 3. Deploy with Kubernetes (Recommended for Production)

```bash
# Ensure kubectl is configured
kubectl cluster-info

# Deploy to Kubernetes
./deploy-cluster.sh kubernetes 5 2

# Check deployment status
kubectl get pods -n threads-cluster
```

## 📊 Accessing the Cluster

### Docker Deployment URLs
- **Main Application**: http://localhost:80
- **Thread Visualization**: http://localhost:80/index.html
- **Collatz Explorer**: http://localhost:80/collatz.html
- **Coordinator API**: http://localhost:3000
- **Monitoring Dashboard**: http://localhost:3001 (admin/admin123)
- **Metrics**: http://localhost:9091

### Kubernetes Deployment URLs
```bash
# Get cluster access URL
kubectl get service load-balancer-service -n threads-cluster

# Port forward for local access
kubectl port-forward service/load-balancer-service 8080:80 -n threads-cluster
```

## 🎛️ Cluster Management

### Scaling Operations

```bash
# Scale CPU workers
docker-compose up -d --scale cpu-worker=5

# Kubernetes scaling
kubectl scale deployment cpu-workers --replicas=8 -n threads-cluster

# Auto-scaling (Kubernetes only)
kubectl autoscale deployment cpu-workers --cpu-percent=70 --min=2 --max=10 -n threads-cluster
```

### Monitoring and Logs

```bash
# View cluster logs (Docker)
./deploy-cluster.sh logs

# View specific service logs
docker-compose logs -f coordinator

# Kubernetes logs
kubectl logs -f deployment/coordinator -n threads-cluster

# Monitor resource usage
kubectl top pods -n threads-cluster
```

### Health Checks

```bash
# Check all services (Docker)
docker-compose ps

# Check cluster health
curl http://localhost:3000/api/status

# Kubernetes health
kubectl get pods -n threads-cluster -w
```

## ⚙️ Configuration

### Environment Variables

#### Coordinator Configuration
```bash
CLUSTER_SIZE=5              # Target cluster size
GPU_ENABLED=true            # Enable GPU acceleration
COORDINATOR_PORT=3000       # API port
METRICS_PORT=9090          # Metrics port
```

#### Worker Configuration
```bash
NODE_TYPE=worker           # Node type (worker/coordinator)
NODE_ID=worker-1          # Unique node identifier
COORDINATOR_URL=http://coordinator:3000
GPU_ENABLED=auto          # auto/true/false
WORKER_THREADS=4          # Number of worker threads
```

### Performance Tuning

#### GPU Workers
```yaml
resources:
  requests:
    nvidia.com/gpu: 1
    memory: "2Gi"
    cpu: "1000m"
  limits:
    nvidia.com/gpu: 1
    memory: "8Gi"
    cpu: "4000m"
```

#### CPU Workers
```yaml
resources:
  requests:
    memory: "1Gi"
    cpu: "500m"
  limits:
    memory: "4Gi"
    cpu: "2000m"
```

## 🔧 Advanced Configuration

### Custom Job Submission

```python
import requests

# Submit thread simulation job
job_data = {
    "type": "thread",
    "priority": "high",
    "gpu_preferred": True,
    "parameters": {
        "thread_count": 1000,
        "max_depth": 10,
        "batch_size": 256
    }
}

response = requests.post("http://localhost:3000/api/submit", json=job_data)
job_id = response.json()["job_id"]
```

### Custom Load Balancing

```nginx
upstream gpu_priority {
    server gpu-worker-1:80 weight=5;
    server gpu-worker-2:80 weight=5;
    server cpu-worker-1:80 weight=1;
}

location /intensive/ {
    proxy_pass http://gpu_priority;
}
```

### Persistent Storage Configuration

```yaml
apiVersion: v1
kind: PersistentVolume
metadata:
  name: cluster-storage
spec:
  capacity:
    storage: 100Gi
  accessModes:
    - ReadWriteMany
  persistentVolumeReclaimPolicy: Retain
  storageClassName: fast-ssd
  nfs:
    server: nfs-server.example.com
    path: /cluster-data
```

## 📈 Performance Optimization

### GPU Optimization

```bash
# Check GPU utilization
nvidia-smi -l 1

# Monitor GPU memory
watch -n 1 nvidia-smi --query-gpu=memory.used,memory.total --format=csv
```

### Memory Management

```bash
# Set memory limits (Docker)
echo 'vm.max_map_count=262144' >> /etc/sysctl.conf
sysctl -p

# Configure swap
sudo swapoff -a
sudo swapon -a
```

### Network Optimization

```bash
# Increase network buffers
echo 'net.core.rmem_max = 16777216' >> /etc/sysctl.conf
echo 'net.core.wmem_max = 16777216' >> /etc/sysctl.conf
sysctl -p
```

## 🚨 Troubleshooting

### Common Issues

#### GPU Not Detected
```bash
# Check GPU availability
nvidia-smi

# Verify Docker GPU support
docker run --rm --gpus all nvidia/cuda:11.0-base nvidia-smi

# Check Kubernetes GPU plugin
kubectl get nodes -o json | jq '.items[].status.allocatable'
```

#### Memory Issues
```bash
# Check memory usage
free -h
docker stats

# Clear Docker cache
docker system prune -a
```

#### Network Connectivity
```bash
# Test coordinator connectivity
curl -v http://coordinator:3000/health

# Check DNS resolution
nslookup coordinator

# Test inter-pod communication
kubectl exec -it pod-name -- ping coordinator-service
```

### Performance Issues

#### High CPU Usage
```bash
# Check CPU usage per container
docker stats --format "table {{.Container}}\t{{.CPUPerc}}\t{{.MemUsage}}"

# Adjust worker thread count
export WORKER_THREADS=2
```

#### GPU Memory Errors
```bash
# Monitor GPU memory
nvidia-smi --query-gpu=memory.used,memory.total --format=csv -l 1

# Reduce batch sizes
export GPU_BATCH_SIZE=512
```

## 📊 Monitoring Setup

### Prometheus Configuration

```yaml
# prometheus.yml
global:
  scrape_interval: 15s

scrape_configs:
  - job_name: 'cluster-coordinator'
    static_configs:
      - targets: ['coordinator:9090']
  
  - job_name: 'cluster-workers'
    kubernetes_sd_configs:
      - role: pod
    relabel_configs:
      - source_labels: [__meta_kubernetes_pod_label_app]
        regex: '.*worker.*'
        action: keep
```

### Grafana Dashboards

Import dashboard ID: `12345` for cluster monitoring

Key metrics to monitor:
- **Job Throughput**: Jobs/second across all nodes
- **GPU Utilization**: GPU usage percentage
- **Memory Usage**: RAM consumption per node
- **Network I/O**: Inter-node communication
- **Error Rates**: Failed job percentage

## 🔒 Security Considerations

### Network Security
```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: cluster-network-policy
spec:
  podSelector: {}
  policyTypes:
  - Ingress
  - Egress
  ingress:
  - from:
    - namespaceSelector:
        matchLabels:
          name: threads-cluster
```

### Access Control
```bash
# Create service account
kubectl create serviceaccount cluster-admin -n threads-cluster

# Bind cluster role
kubectl create clusterrolebinding cluster-admin-binding \
  --clusterrole=cluster-admin \
  --serviceaccount=threads-cluster:cluster-admin
```

## 🚀 Production Deployment

### High Availability Setup

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: coordinator
spec:
  replicas: 3  # Multiple coordinator instances
  selector:
    matchLabels:
      app: coordinator
  template:
    spec:
      affinity:
        podAntiAffinity:
          requiredDuringSchedulingIgnoredDuringExecution:
          - labelSelector:
              matchExpressions:
              - key: app
                operator: In
                values:
                - coordinator
            topologyKey: kubernetes.io/hostname
```

### Backup and Recovery

```bash
# Backup cluster data
kubectl create backup cluster-backup --include-namespaces=threads-cluster

# Restore from backup
kubectl restore cluster-backup --restore-name=cluster-restore
```

## 📞 Support and Maintenance

### Regular Maintenance Tasks

```bash
# Weekly cleanup
./deploy-cluster.sh cleanup
docker system prune -a

# Update images
docker-compose pull
docker-compose up -d

# Check cluster health
./deploy-cluster.sh status
```

### Performance Monitoring

```bash
# Generate performance report
./deploy-cluster.sh report

# Export metrics
curl http://localhost:9090/api/v1/query?query=cluster_jobs_total
```

---

## 🎯 Quick Reference Commands

```bash
# Deployment
./deploy-cluster.sh docker 5 2        # Docker: 5 workers (2 GPU)
./deploy-cluster.sh kubernetes 10 4   # K8s: 10 workers (4 GPU)

# Management
./deploy-cluster.sh logs              # View logs
./deploy-cluster.sh scale 8           # Scale to 8 workers
./deploy-cluster.sh stop              # Stop cluster
./deploy-cluster.sh cleanup           # Full cleanup

# Monitoring
curl localhost:3000/api/status        # Cluster status
docker-compose ps                     # Service status
kubectl get pods -n threads-cluster   # K8s pod status
```

---

**🚀 Your GPU-accelerated cluster is ready for massive parallel computing workloads!**
