#!/bin/bash

# GPU-Accelerated Thread & Collatz Cluster Deployment Script
# Supports Docker Compose and Kubernetes deployments

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
DEPLOYMENT_TYPE="${1:-docker}"  # docker or kubernetes
CLUSTER_SIZE="${2:-3}"
GPU_NODES="${3:-1}"

print_header() {
    echo -e "${BLUE}========================================${NC}"
    echo -e "${BLUE}  GPU-Accelerated Cluster Deployment   ${NC}"
    echo -e "${BLUE}========================================${NC}"
    echo ""
}

print_status() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

check_dependencies() {
    print_status "Checking dependencies..."
    
    if [ "$DEPLOYMENT_TYPE" = "docker" ]; then
        if ! command -v docker &> /dev/null; then
            print_error "Docker is not installed"
            exit 1
        fi
        
        if ! command -v docker-compose &> /dev/null; then
            print_error "Docker Compose is not installed"
            exit 1
        fi
        
        print_status "Docker and Docker Compose found"
    elif [ "$DEPLOYMENT_TYPE" = "kubernetes" ]; then
        if ! command -v kubectl &> /dev/null; then
            print_error "kubectl is not installed"
            exit 1
        fi
        
        if ! kubectl cluster-info &> /dev/null; then
            print_error "Kubernetes cluster is not accessible"
            exit 1
        fi
        
        print_status "Kubernetes cluster is accessible"
    fi
}

check_gpu_support() {
    print_status "Checking GPU support..."
    
    if command -v nvidia-smi &> /dev/null; then
        GPU_COUNT=$(nvidia-smi --list-gpus | wc -l)
        print_status "Found $GPU_COUNT NVIDIA GPU(s)"
        
        if [ "$DEPLOYMENT_TYPE" = "docker" ]; then
            if ! docker run --rm --gpus all nvidia/cuda:11.0-base nvidia-smi &> /dev/null; then
                print_warning "Docker GPU support not available, using CPU-only mode"
                GPU_NODES=0
            else
                print_status "Docker GPU support confirmed"
            fi
        elif [ "$DEPLOYMENT_TYPE" = "kubernetes" ]; then
            if ! kubectl get nodes -o json | grep -q "nvidia.com/gpu"; then
                print_warning "Kubernetes GPU support not detected, using CPU-only mode"
                GPU_NODES=0
            else
                print_status "Kubernetes GPU support confirmed"
            fi
        fi
    else
        print_warning "No GPU detected, deploying in CPU-only mode"
        GPU_NODES=0
    fi
}

build_docker_image() {
    print_status "Building Docker image..."
    
    docker build -t threads-cluster:latest . || {
        print_error "Failed to build Docker image"
        exit 1
    }
    
    print_status "Docker image built successfully"
}

deploy_docker() {
    print_status "Deploying with Docker Compose..."
    
    # Create necessary directories
    mkdir -p cluster-data logs ssl grafana-data monitoring-data
    
    # Generate docker-compose override for scaling
    cat > docker-compose.override.yml << EOF
version: '3.8'

services:
  coordinator:
    environment:
      - CLUSTER_SIZE=${CLUSTER_SIZE}
      - GPU_ENABLED=${GPU_NODES:-true}

EOF

    # Add GPU workers if GPU support is available
    if [ "$GPU_NODES" -gt 0 ]; then
        for i in $(seq 1 $GPU_NODES); do
            cat >> docker-compose.override.yml << EOF
  gpu-worker-${i}:
    extends:
      service: worker-1
    container_name: threads-gpu-worker-${i}
    environment:
      - NODE_ID=gpu-worker-${i}
      - GPU_ENABLED=true
    ports:
      - "$((8080 + i)):80"
      - "$((9080 + i)):8080"
    deploy:
      resources:
        reservations:
          devices:
            - driver: nvidia
              count: 1
              capabilities: [gpu]

EOF
        done
    fi
    
    # Add CPU workers
    CPU_WORKERS=$((CLUSTER_SIZE - GPU_NODES))
    for i in $(seq 1 $CPU_WORKERS); do
        WORKER_NUM=$((GPU_NODES + i))
        cat >> docker-compose.override.yml << EOF
  cpu-worker-${i}:
    extends:
      service: worker-2
    container_name: threads-cpu-worker-${i}
    environment:
      - NODE_ID=cpu-worker-${i}
      - GPU_ENABLED=false
      - WORKER_THREADS=8
    ports:
      - "$((8080 + WORKER_NUM)):80"
      - "$((9080 + WORKER_NUM)):8080"

EOF
    done
    
    # Start the cluster
    docker-compose up -d || {
        print_error "Failed to start Docker Compose cluster"
        exit 1
    }
    
    print_status "Docker Compose cluster started successfully"
    
    # Wait for services to be ready
    print_status "Waiting for services to be ready..."
    sleep 30
    
    # Check service health
    check_docker_health
}

deploy_kubernetes() {
    print_status "Deploying to Kubernetes..."
    
    # Create namespace if it doesn't exist
    kubectl create namespace threads-cluster --dry-run=client -o yaml | kubectl apply -f -
    
    # Update deployment configuration
    sed -i.bak "s/replicas: 2/replicas: ${GPU_NODES}/" k8s-deployment.yaml
    sed -i.bak "s/replicas: 3/replicas: $((CLUSTER_SIZE - GPU_NODES))/" k8s-deployment.yaml
    
    # Apply Kubernetes configurations
    kubectl apply -f k8s-deployment.yaml || {
        print_error "Failed to deploy to Kubernetes"
        exit 1
    }
    
    print_status "Kubernetes deployment applied successfully"
    
    # Wait for pods to be ready
    print_status "Waiting for pods to be ready..."
    kubectl wait --for=condition=ready pod -l app=coordinator -n threads-cluster --timeout=300s
    kubectl wait --for=condition=ready pod -l app=gpu-worker -n threads-cluster --timeout=300s
    kubectl wait --for=condition=ready pod -l app=cpu-worker -n threads-cluster --timeout=300s
    
    # Check deployment health
    check_kubernetes_health
}

check_docker_health() {
    print_status "Checking Docker service health..."
    
    # Check coordinator
    if curl -s http://localhost:3000/health | grep -q "healthy"; then
        print_status "Coordinator is healthy"
    else
        print_warning "Coordinator health check failed"
    fi
    
    # Check load balancer
    if curl -s http://localhost:80/health | grep -q "healthy"; then
        print_status "Load balancer is healthy"
    else
        print_warning "Load balancer health check failed"
    fi
    
    # List running services
    echo ""
    print_status "Running services:"
    docker-compose ps
}

check_kubernetes_health() {
    print_status "Checking Kubernetes deployment health..."
    
    # Check pod status
    echo ""
    print_status "Pod status:"
    kubectl get pods -n threads-cluster
    
    # Check services
    echo ""
    print_status "Services:"
    kubectl get services -n threads-cluster
    
    # Get external access information
    NODE_PORT=$(kubectl get service load-balancer-service -n threads-cluster -o jsonpath='{.spec.ports[0].nodePort}')
    NODE_IP=$(kubectl get nodes -o jsonpath='{.items[0].status.addresses[?(@.type=="ExternalIP")].address}')
    
    if [ -z "$NODE_IP" ]; then
        NODE_IP=$(kubectl get nodes -o jsonpath='{.items[0].status.addresses[?(@.type=="InternalIP")].address}')
    fi
    
    echo ""
    print_status "Cluster access URL: http://${NODE_IP}:${NODE_PORT}"
}

show_usage() {
    echo "Usage: $0 [deployment_type] [cluster_size] [gpu_nodes]"
    echo ""
    echo "Parameters:"
    echo "  deployment_type  : docker or kubernetes (default: docker)"
    echo "  cluster_size     : Total number of worker nodes (default: 3)"
    echo "  gpu_nodes        : Number of GPU-enabled nodes (default: 1)"
    echo ""
    echo "Examples:"
    echo "  $0 docker 5 2        # Docker with 5 workers (2 GPU, 3 CPU)"
    echo "  $0 kubernetes 10 4   # Kubernetes with 10 workers (4 GPU, 6 CPU)"
    echo ""
}

cleanup() {
    print_status "Cleaning up..."
    
    if [ "$DEPLOYMENT_TYPE" = "docker" ]; then
        docker-compose down -v
        docker system prune -f
    elif [ "$DEPLOYMENT_TYPE" = "kubernetes" ]; then
        kubectl delete namespace threads-cluster
    fi
    
    print_status "Cleanup completed"
}

show_cluster_info() {
    echo ""
    print_header
    echo -e "${GREEN}Cluster Information:${NC}"
    echo "  Deployment Type: $DEPLOYMENT_TYPE"
    echo "  Cluster Size: $CLUSTER_SIZE workers"
    echo "  GPU Nodes: $GPU_NODES"
    echo "  CPU Nodes: $((CLUSTER_SIZE - GPU_NODES))"
    echo ""
    
    if [ "$DEPLOYMENT_TYPE" = "docker" ]; then
        echo -e "${GREEN}Access URLs:${NC}"
        echo "  Main Application: http://localhost:80"
        echo "  Coordinator API: http://localhost:3000"
        echo "  Monitoring: http://localhost:3001 (admin/admin123)"
        echo "  Metrics: http://localhost:9091"
    elif [ "$DEPLOYMENT_TYPE" = "kubernetes" ]; then
        NODE_PORT=$(kubectl get service load-balancer-service -n threads-cluster -o jsonpath='{.spec.ports[0].nodePort}' 2>/dev/null || echo "30080")
        NODE_IP=$(kubectl get nodes -o jsonpath='{.items[0].status.addresses[?(@.type=="ExternalIP")].address}' 2>/dev/null)
        
        if [ -z "$NODE_IP" ]; then
            NODE_IP=$(kubectl get nodes -o jsonpath='{.items[0].status.addresses[?(@.type=="InternalIP")].address}' 2>/dev/null || echo "localhost")
        fi
        
        echo -e "${GREEN}Access URLs:${NC}"
        echo "  Main Application: http://${NODE_IP}:${NODE_PORT}"
        echo "  Kubernetes Dashboard: kubectl proxy"
    fi
    
    echo ""
    echo -e "${GREEN}Management Commands:${NC}"
    echo "  View logs: $0 logs"
    echo "  Scale cluster: $0 scale [new_size]"
    echo "  Stop cluster: $0 stop"
    echo "  Cleanup: $0 cleanup"
    echo ""
}

# Main execution
case "${1:-deploy}" in
    "help"|"-h"|"--help")
        show_usage
        exit 0
        ;;
    "cleanup")
        cleanup
        exit 0
        ;;
    "logs")
        if [ "$DEPLOYMENT_TYPE" = "docker" ]; then
            docker-compose logs -f
        elif [ "$DEPLOYMENT_TYPE" = "kubernetes" ]; then
            kubectl logs -f -l app=coordinator -n threads-cluster
        fi
        exit 0
        ;;
    "stop")
        if [ "$DEPLOYMENT_TYPE" = "docker" ]; then
            docker-compose stop
        elif [ "$DEPLOYMENT_TYPE" = "kubernetes" ]; then
            kubectl scale deployment --replicas=0 --all -n threads-cluster
        fi
        exit 0
        ;;
    "scale")
        NEW_SIZE="${2:-5}"
        print_status "Scaling cluster to $NEW_SIZE nodes..."
        if [ "$DEPLOYMENT_TYPE" = "kubernetes" ]; then
            kubectl scale deployment cpu-workers --replicas=$NEW_SIZE -n threads-cluster
        fi
        exit 0
        ;;
    *)
        # Default deployment
        print_header
        
        # Validate deployment type
        if [ "$DEPLOYMENT_TYPE" != "docker" ] && [ "$DEPLOYMENT_TYPE" != "kubernetes" ]; then
            print_error "Invalid deployment type. Use 'docker' or 'kubernetes'"
            show_usage
            exit 1
        fi
        
        # Run deployment
        check_dependencies
        check_gpu_support
        
        if [ "$DEPLOYMENT_TYPE" = "docker" ]; then
            build_docker_image
            deploy_docker
        elif [ "$DEPLOYMENT_TYPE" = "kubernetes" ]; then
            build_docker_image
            deploy_kubernetes
        fi
        
        show_cluster_info
        
        print_status "Cluster deployment completed successfully!"
        ;;
esac
