# GPU-Accelerated Thread & Collatz Cluster Node
FROM node:18-alpine

# Install system dependencies for GPU support
RUN apk add --no-cache \
    nginx \
    supervisor \
    curl \
    bash \
    python3 \
    py3-pip

# Create application directory
WORKDIR /app

# Copy application files
COPY index.html collatz.html ./
COPY script.js collatz.js ./
COPY styles.css collatz.css ./
COPY threads.py ./

# Create cluster coordination files
RUN mkdir -p /app/cluster

# Copy cluster configuration
COPY cluster/ ./cluster/

# Install Python dependencies for cluster coordination
RUN pip3 install flask requests websockets asyncio

# Create nginx configuration for load balancing
COPY nginx.conf /etc/nginx/nginx.conf

# Create supervisor configuration
COPY supervisord.conf /etc/supervisor/conf.d/supervisord.conf

# Expose ports
EXPOSE 80 8080 9090 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:80/ || exit 1

# Start supervisor to manage all services
CMD ["/usr/bin/supervisord", "-c", "/etc/supervisor/conf.d/supervisord.conf"]
