class ThreadSimulator {
    constructor() {
        this.isRunning = false;
        this.threads = new Map();
        this.threadCounter = 0;
        this.totalThreadsCreated = 0;
        this.maxDepthReached = 0;
        this.startTime = null;
        this.runtimeInterval = null;
        this.mainInterval = null;
        this.cleanupIntervalId = null;
        
        // GPU acceleration
        this.gpuAccelerated = false;
        this.gl = null;
        this.computeShader = null;
        this.workers = [];
        this.batchSize = 1024;
        this.processingQueue = [];
        
        // Settings
        this.speed = 500;
        this.maxDepth = Infinity; // Infinite depth
        this.maxThreads = Infinity; // Infinite threads
        
        // Performance settings
        this.maxVisualizationNodes = 200; // Limit visual nodes for performance
        this.maxLogEntries = 500; // Limit log entries
        this.cleanupInterval = 5000; // Cleanup old threads every 5 seconds
        
        // UI elements
        this.initializeElements();
        this.setupEventListeners();
        this.initializeGPU();
        this.updateStats();
        this.currentView = 'tree';
    }
    
    initializeElements() {
        // Control buttons
        this.startBtn = document.getElementById('startBtn');
        this.pauseBtn = document.getElementById('pauseBtn');
        this.resetBtn = document.getElementById('resetBtn');
        
        // Settings
        this.speedSlider = document.getElementById('speedSlider');
        this.speedValue = document.getElementById('speedValue');
        this.maxDepthInput = document.getElementById('maxDepth');
        this.maxThreadsInput = document.getElementById('maxThreads');
        
        // Stats
        this.accelerationTypeSpan = document.getElementById('accelerationType');
        this.activeThreadsSpan = document.getElementById('activeThreads');
        this.totalThreadsSpan = document.getElementById('totalThreads');
        this.maxDepthReachedSpan = document.getElementById('maxDepthReached');
        this.processingRateSpan = document.getElementById('processingRate');
        this.runtimeSpan = document.getElementById('runtime');
        
        // Visualization
        this.threadTree = document.getElementById('threadTree');
        this.threadLog = document.getElementById('threadLog');
        this.treeViewBtn = document.getElementById('treeViewBtn');
        this.logViewBtn = document.getElementById('logViewBtn');
        this.treeView = document.getElementById('treeView');
        this.logView = document.getElementById('logView');
        this.clearLogBtn = document.getElementById('clearLogBtn');
        this.autoScrollBtn = document.getElementById('autoScrollBtn');
        
        this.autoScroll = true;
    }
    
    setupEventListeners() {
        // Control buttons
        this.startBtn.addEventListener('click', () => this.start());
        this.pauseBtn.addEventListener('click', () => this.pause());
        this.resetBtn.addEventListener('click', () => this.reset());
        
        // Settings
        this.speedSlider.addEventListener('input', (e) => {
            this.speed = parseInt(e.target.value);
            this.speedValue.textContent = this.speed;
        });
        
        this.maxDepthInput.addEventListener('change', (e) => {
            const value = parseInt(e.target.value);
            this.maxDepth = value === 0 ? Infinity : value;
        });
        
        this.maxThreadsInput.addEventListener('change', (e) => {
            const value = parseInt(e.target.value);
            this.maxThreads = value === 0 ? Infinity : value;
        });
        
        // View controls
        this.treeViewBtn.addEventListener('click', () => this.switchView('tree'));
        this.logViewBtn.addEventListener('click', () => this.switchView('log'));
        
        // Log controls
        this.clearLogBtn.addEventListener('click', () => this.clearLog());
        this.autoScrollBtn.addEventListener('click', () => this.toggleAutoScroll());
    }
    
    initializeGPU() {
        try {
            // Create a canvas for WebGL compute
            const canvas = document.createElement('canvas');
            canvas.width = 1;
            canvas.height = 1;
            this.gl = canvas.getContext('webgl2-compute', {antialias: false});
            
            if (!this.gl) {
                console.log('WebGL2 Compute not supported, falling back to Web Workers');
                this.initializeWorkers();
                return;
            }
            
            // Create compute shader for parallel thread processing
            const computeShaderSource = `#version 310 es
                layout(local_size_x = 64, local_size_y = 1, local_size_z = 1) in;
                
                layout(std430, binding = 0) restrict readonly buffer InputBuffer {
                    uint inputData[];
                };
                
                layout(std430, binding = 1) restrict writeonly buffer OutputBuffer {
                    uint outputData[];
                };
                
                uint processThread(uint threadId, uint depth) {
                    // Simulate thread processing with mathematical operations
                    uint result = threadId;
                    
                    // Apply transformations based on depth
                    for (uint i = 0u; i < depth && i < 10u; i++) {
                        if (result % 2u == 0u) {
                            result = result / 2u;
                        } else {
                            result = result * 3u + 1u;
                        }
                        
                        // Prevent overflow
                        if (result > 1000000u) break;
                    }
                    
                    return result;
                }
                
                void main() {
                    uint index = gl_GlobalInvocationID.x;
                    if (index >= inputData.length()) return;
                    
                    uint threadId = inputData[index * 2u];
                    uint depth = inputData[index * 2u + 1u];
                    
                    uint result = processThread(threadId, depth);
                    outputData[index] = result;
                }
            `;
            
            this.computeShader = this.createComputeShader(computeShaderSource);
            if (this.computeShader) {
                this.gpuAccelerated = true;
                console.log('🚀 GPU acceleration enabled for thread processing!');
                this.updateAccelerationType();
            } else {
                this.initializeWorkers();
            }
            
        } catch (error) {
            console.log('GPU initialization failed, using Web Workers:', error);
            this.initializeWorkers();
        }
    }
    
    createComputeShader(source) {
        if (!this.gl) return null;
        
        const shader = this.gl.createShader(this.gl.COMPUTE_SHADER);
        this.gl.shaderSource(shader, source);
        this.gl.compileShader(shader);
        
        if (!this.gl.getShaderParameter(shader, this.gl.COMPILE_STATUS)) {
            console.error('Compute shader compilation failed:', this.gl.getShaderInfoLog(shader));
            return null;
        }
        
        const program = this.gl.createProgram();
        this.gl.attachShader(program, shader);
        this.gl.linkProgram(program);
        
        if (!this.gl.getProgramParameter(program, this.gl.LINK_STATUS)) {
            console.error('Compute shader program linking failed:', this.gl.getProgramInfoLog(program));
            return null;
        }
        
        return program;
    }
    
    initializeWorkers() {
        const numWorkers = navigator.hardwareConcurrency || 4;
        
        for (let i = 0; i < numWorkers; i++) {
            const workerCode = `
                self.onmessage = function(e) {
                    const { threadData, batchId } = e.data;
                    const results = [];
                    
                    for (const thread of threadData) {
                        // Simulate complex thread processing
                        let result = thread.id;
                        const depth = thread.depth;
                        
                        // Apply transformations
                        for (let i = 0; i < depth && i < 10; i++) {
                            if (result % 2 === 0) {
                                result = result / 2;
                            } else {
                                result = result * 3 + 1;
                            }
                            if (result > 1000000) break;
                        }
                        
                        results.push({
                            originalId: thread.id,
                            depth: depth,
                            result: result,
                            processingTime: Math.random() * 100 + 50
                        });
                    }
                    
                    self.postMessage({ results, batchId });
                };
            `;
            
            const blob = new Blob([workerCode], { type: 'application/javascript' });
            const worker = new Worker(URL.createObjectURL(blob));
            
            worker.onmessage = (e) => {
                this.handleWorkerResult(e.data);
            };
            
            this.workers.push(worker);
        }
        
        console.log(`🧵 Initialized ${numWorkers} Web Workers for parallel thread processing`);
        this.updateAccelerationType();
    }
    
    updateAccelerationType() {
        if (this.accelerationTypeSpan) {
            const type = this.gpuAccelerated ? 
                '🚀 GPU (WebGL Compute)' : 
                `🧵 CPU (${this.workers.length} Workers)`;
            this.accelerationTypeSpan.textContent = type;
            this.accelerationTypeSpan.className = this.gpuAccelerated ? 'stat-value gpu-accelerated' : 'stat-value cpu-accelerated';
        }
    }
    
    processThreadsBatch(threads) {
        if (this.gpuAccelerated && this.computeShader) {
            return this.processThreadsGPU(threads);
        } else {
            return this.processThreadsWorkers(threads);
        }
    }
    
    processThreadsGPU(threads) {
        if (!this.gl || !this.computeShader) return;
        
        const inputData = new Uint32Array(threads.length * 2);
        for (let i = 0; i < threads.length; i++) {
            inputData[i * 2] = threads[i].id || i;
            inputData[i * 2 + 1] = threads[i].depth || 0;
        }
        
        // Create buffers
        const inputBuffer = this.gl.createBuffer();
        const outputBuffer = this.gl.createBuffer();
        
        // Upload input data
        this.gl.bindBuffer(this.gl.SHADER_STORAGE_BUFFER, inputBuffer);
        this.gl.bufferData(this.gl.SHADER_STORAGE_BUFFER, inputData, this.gl.STATIC_READ);
        this.gl.bindBufferBase(this.gl.SHADER_STORAGE_BUFFER, 0, inputBuffer);
        
        // Create output buffer
        this.gl.bindBuffer(this.gl.SHADER_STORAGE_BUFFER, outputBuffer);
        this.gl.bufferData(this.gl.SHADER_STORAGE_BUFFER, threads.length * 4, this.gl.STATIC_READ);
        this.gl.bindBufferBase(this.gl.SHADER_STORAGE_BUFFER, 1, outputBuffer);
        
        // Dispatch compute shader
        this.gl.useProgram(this.computeShader);
        const workGroupSize = Math.ceil(threads.length / 64);
        this.gl.dispatchCompute(workGroupSize, 1, 1);
        this.gl.memoryBarrier(this.gl.SHADER_STORAGE_BARRIER_BIT);
        
        // Read results
        this.gl.bindBuffer(this.gl.SHADER_STORAGE_BUFFER, outputBuffer);
        const results = new Uint32Array(threads.length);
        this.gl.getBufferSubData(this.gl.SHADER_STORAGE_BUFFER, 0, results);
        
        // Process results
        for (let i = 0; i < threads.length; i++) {
            threads[i].gpuResult = results[i];
            threads[i].processed = true;
        }
        
        // Cleanup
        this.gl.deleteBuffer(inputBuffer);
        this.gl.deleteBuffer(outputBuffer);
        
        return threads;
    }
    
    processThreadsWorkers(threads) {
        const batchId = Date.now();
        const batchSize = Math.ceil(threads.length / this.workers.length);
        
        for (let i = 0; i < this.workers.length; i++) {
            const start = i * batchSize;
            const end = Math.min(start + batchSize, threads.length);
            const threadBatch = threads.slice(start, end);
            
            if (threadBatch.length > 0) {
                this.workers[i].postMessage({
                    threadData: threadBatch,
                    batchId: batchId
                });
            }
        }
    }
    
    handleWorkerResult(data) {
        const { results, batchId } = data;
        
        for (const result of results) {
            // Update thread with processing results
            const thread = Array.from(this.threads.values()).find(t => 
                t.id === result.originalId || t.name.includes(result.originalId)
            );
            
            if (thread) {
                thread.workerResult = result.result;
                thread.processingTime = result.processingTime;
                thread.processed = true;
            }
        }
        
        this.updateStats();
    }
    
    start() {
        if (this.isRunning) return;
        
        this.isRunning = true;
        this.startTime = Date.now();
        this.startBtn.disabled = true;
        this.pauseBtn.disabled = false;
        
        // Start runtime counter
        this.runtimeInterval = setInterval(() => this.updateRuntime(), 1000);
        
        // Start cleanup interval for performance
        this.cleanupIntervalId = setInterval(() => this.performCleanup(), this.cleanupInterval);
        
        // Start main thread creation loop
        this.createMainThreadLoop();
        
        const accelerationType = this.gpuAccelerated ? 'GPU (WebGL Compute)' : `CPU (${this.workers.length} Workers)`;
        this.log(`System started - Infinite Mode (${accelerationType})`, 'SYSTEM', 0);
        this.log(`Max Depth: ${this.maxDepth === Infinity ? '∞' : this.maxDepth}, Max Threads: ${this.maxThreads === Infinity ? '∞' : this.maxThreads}`, 'SYSTEM', 0);
    }
    
    pause() {
        if (!this.isRunning) return;
        
        this.isRunning = false;
        this.startBtn.disabled = false;
        this.pauseBtn.disabled = true;
        
        if (this.runtimeInterval) {
            clearInterval(this.runtimeInterval);
            this.runtimeInterval = null;
        }
        
        if (this.cleanupIntervalId) {
            clearInterval(this.cleanupIntervalId);
            this.cleanupIntervalId = null;
        }
        
        if (this.mainInterval) {
            clearTimeout(this.mainInterval);
            this.mainInterval = null;
        }
        
        // Clear all pending thread timeouts
        this.threads.forEach(thread => {
            if (thread.timeout) {
                clearTimeout(thread.timeout);
            }
        });
        
        this.log('System paused', 'SYSTEM', 0);
    }
    
    reset() {
        this.pause();
        
        this.threads.clear();
        this.threadCounter = 0;
        this.totalThreadsCreated = 0;
        this.maxDepthReached = 0;
        this.startTime = null;
        
        // Clear visualizations
        this.threadTree.innerHTML = '';
        this.threadLog.innerHTML = '';
        
        this.updateStats();
        this.log('System reset', 'SYSTEM', 0);
    }
    
    createMainThreadLoop() {
        if (!this.isRunning) return;
        
        // Create batch of threads for GPU/parallel processing
        const batchSize = this.gpuAccelerated ? Math.min(this.batchSize, 256) : Math.min(this.workers.length * 4, 32);
        const threadBatch = [];
        
        for (let i = 0; i < batchSize; i++) {
            const threadName = `Thread-${this.threadCounter}`;
            const thread = this.createThreadData(threadName, 0);
            threadBatch.push(thread);
            this.threadCounter++;
        }
        
        // Process batch with GPU or Workers
        if (threadBatch.length > 0) {
            this.processingQueue.push(...threadBatch);
            this.processBatch();
        }
        
        // Schedule next batch creation
        this.mainInterval = setTimeout(() => this.createMainThreadLoop(), this.speed);
    }
    
    createThreadData(name, depth, parentId = null) {
        const threadId = `${name}-${Date.now()}-${Math.random()}`;
        return {
            id: threadId,
            name: name,
            depth: depth,
            parentId: parentId,
            createdAt: Date.now(),
            timeout: null,
            processed: false
        };
    }
    
    processBatch() {
        if (this.processingQueue.length === 0) return;
        
        const batch = this.processingQueue.splice(0, Math.min(this.processingQueue.length, this.batchSize));
        
        // Add to threads map
        batch.forEach(thread => {
            this.threads.set(thread.id, thread);
            this.totalThreadsCreated++;
            this.maxDepthReached = Math.max(this.maxDepthReached, thread.depth);
        });
        
        // Process with GPU or Workers
        this.processThreadsBatch(batch);
        
        // Visualize and log results
        batch.forEach(thread => {
            this.log(`Thread ${thread.name} started at depth ${thread.depth}`, thread.name, thread.depth);
            this.visualizeThread(thread);
            
            // Schedule child thread creation
            if (thread.depth < this.maxDepth && this.isRunning) {
                thread.timeout = setTimeout(() => {
                    if (this.isRunning && this.threads.has(thread.id)) {
                        const childThread = this.createThreadData(thread.name + '*', thread.depth + 1, thread.id);
                        this.processingQueue.push(childThread);
                        
                        // Remove parent thread after creating child
                        setTimeout(() => {
                            this.removeThread(thread.id);
                        }, this.speed * 2);
                    }
                }, this.speed + Math.random() * this.speed);
            } else {
                // Remove thread after some time if it won't create children
                thread.timeout = setTimeout(() => {
                    this.removeThread(thread.id);
                }, this.speed * 3);
            }
        });
        
        this.updateStats();
    }
    
    createThread(name, depth, parentId = null) {
        if (!this.isRunning) return;
        
        const threadId = `${name}-${Date.now()}-${Math.random()}`;
        const thread = {
            id: threadId,
            name: name,
            depth: depth,
            parentId: parentId,
            createdAt: Date.now(),
            timeout: null
        };
        
        this.threads.set(threadId, thread);
        this.totalThreadsCreated++;
        this.maxDepthReached = Math.max(this.maxDepthReached, depth);
        
        this.log(`Thread ${name} started at depth ${depth}`, name, depth);
        this.visualizeThread(thread);
        this.updateStats();
        
        // Schedule child thread creation if within depth limit
        if (depth < this.maxDepth && this.isRunning) {
            thread.timeout = setTimeout(() => {
                if (this.isRunning && this.threads.has(threadId)) {
                    this.createThread(name + '*', depth + 1, threadId);
                    
                    // Remove this thread after creating child
                    setTimeout(() => {
                        this.removeThread(threadId);
                    }, this.speed * 2);
                }
            }, this.speed + Math.random() * this.speed);
        } else {
            // Remove thread after some time if it won't create children
            thread.timeout = setTimeout(() => {
                this.removeThread(threadId);
            }, this.speed * 3);
        }
    }
    
    removeThread(threadId) {
        if (this.threads.has(threadId)) {
            const thread = this.threads.get(threadId);
            this.threads.delete(threadId);
            
            // Remove from visualization
            const node = document.querySelector(`[data-thread-id="${threadId}"]`);
            if (node) {
                node.style.animation = 'nodeDisappear 0.3s ease-in forwards';
                setTimeout(() => {
                    if (node.parentNode) {
                        node.parentNode.removeChild(node);
                    }
                }, 300);
            }
            
            this.updateStats();
        }
    }
    
    performCleanup() {
        // Clean up old threads to prevent memory overflow
        const now = Date.now();
        const threadsToRemove = [];
        
        this.threads.forEach((thread, id) => {
            // Remove threads older than 30 seconds in infinite mode
            if (now - thread.createdAt > 30000) {
                threadsToRemove.push(id);
            }
        });
        
        threadsToRemove.forEach(id => this.removeThread(id));
        
        // Limit visualization nodes for performance
        const nodes = this.threadTree.children;
        if (nodes.length > this.maxVisualizationNodes) {
            const nodesToRemove = Array.from(nodes).slice(0, nodes.length - this.maxVisualizationNodes);
            nodesToRemove.forEach(node => {
                if (node.parentNode) {
                    node.parentNode.removeChild(node);
                }
            });
        }
        
        // Limit log entries
        const logEntries = this.threadLog.children;
        if (logEntries.length > this.maxLogEntries) {
            const entriesToRemove = Array.from(logEntries).slice(0, logEntries.length - this.maxLogEntries);
            entriesToRemove.forEach(entry => {
                if (entry.parentNode) {
                    entry.parentNode.removeChild(entry);
                }
            });
        }
    }
    
    visualizeThread(thread) {
        if (this.currentView !== 'tree') return;
        
        const node = document.createElement('div');
        node.className = `thread-node depth-${Math.min(thread.depth, 3)}`;
        node.textContent = thread.name;
        node.setAttribute('data-thread-id', thread.id);
        
        // Position calculation
        const x = 50 + (thread.depth * 200) + (Math.random() * 100 - 50);
        const y = 50 + (this.threads.size % 10) * 60 + (Math.random() * 30 - 15);
        
        node.style.left = `${x}px`;
        node.style.top = `${y}px`;
        
        // Add click event for thread details
        node.addEventListener('click', () => {
            this.showThreadDetails(thread);
        });
        
        this.threadTree.appendChild(node);
        
        // Draw connection to parent if exists
        if (thread.parentId) {
            this.drawConnection(thread.parentId, thread.id);
        }
        
        // Auto-remove node animation
        const removeAnimation = document.createElement('style');
        removeAnimation.textContent = `
            @keyframes nodeDisappear {
                to {
                    opacity: 0;
                    transform: scale(0.8) translateY(20px);
                }
            }
        `;
        if (!document.head.querySelector('[data-animation="nodeDisappear"]')) {
            removeAnimation.setAttribute('data-animation', 'nodeDisappear');
            document.head.appendChild(removeAnimation);
        }
    }
    
    drawConnection(parentId, childId) {
        const parentNode = document.querySelector(`[data-thread-id="${parentId}"]`);
        const childNode = document.querySelector(`[data-thread-id="${childId}"]`);
        
        if (!parentNode || !childNode) return;
        
        const parentRect = parentNode.getBoundingClientRect();
        const childRect = childNode.getBoundingClientRect();
        const containerRect = this.threadTree.getBoundingClientRect();
        
        const connection = document.createElement('div');
        connection.className = 'thread-connection';
        connection.setAttribute('data-parent', parentId);
        connection.setAttribute('data-child', childId);
        
        const startX = parentRect.left - containerRect.left + parentRect.width;
        const startY = parentRect.top - containerRect.top + parentRect.height / 2;
        const endX = childRect.left - containerRect.left;
        const endY = childRect.top - containerRect.top + childRect.height / 2;
        
        const length = Math.sqrt(Math.pow(endX - startX, 2) + Math.pow(endY - startY, 2));
        const angle = Math.atan2(endY - startY, endX - startX) * 180 / Math.PI;
        
        connection.style.left = `${startX}px`;
        connection.style.top = `${startY}px`;
        connection.style.width = `${length}px`;
        connection.style.transform = `rotate(${angle}deg)`;
        connection.style.transformOrigin = '0 50%';
        
        this.threadTree.appendChild(connection);
        
        // Remove connection when child is removed
        setTimeout(() => {
            if (connection.parentNode && !document.querySelector(`[data-thread-id="${childId}"]`)) {
                connection.parentNode.removeChild(connection);
            }
        }, this.speed * 4);
    }
    
    showThreadDetails(thread) {
        const details = `
Thread Details:
- Name: ${thread.name}
- Depth: ${thread.depth}
- Created: ${new Date(thread.createdAt).toLocaleTimeString()}
- Parent: ${thread.parentId ? 'Yes' : 'Root'}
        `.trim();
        
        alert(details);
    }
    
    log(message, threadName, depth) {
        const timestamp = new Date().toLocaleTimeString();
        const entry = document.createElement('div');
        entry.className = 'log-entry';
        
        entry.innerHTML = `
            <span class="timestamp">[${timestamp}]</span>
            <span class="thread-name">${threadName}</span>
            <span class="depth">(depth: ${depth})</span>
            - ${message}
        `;
        
        this.threadLog.appendChild(entry);
        
        // Auto-scroll if enabled
        if (this.autoScroll) {
            this.threadLog.scrollTop = this.threadLog.scrollHeight;
        }
        
        // Limit log entries to prevent memory issues
        const entries = this.threadLog.children;
        if (entries.length > 1000) {
            this.threadLog.removeChild(entries[0]);
        }
    }
    
    switchView(view) {
        this.currentView = view;
        
        if (view === 'tree') {
            this.treeView.style.display = 'block';
            this.logView.style.display = 'none';
            this.treeViewBtn.classList.add('active');
            this.logViewBtn.classList.remove('active');
        } else {
            this.treeView.style.display = 'none';
            this.logView.style.display = 'block';
            this.treeViewBtn.classList.remove('active');
            this.logViewBtn.classList.add('active');
        }
    }
    
    clearLog() {
        this.threadLog.innerHTML = '';
        this.log('Log cleared', 'SYSTEM', 0);
    }
    
    toggleAutoScroll() {
        this.autoScroll = !this.autoScroll;
        this.autoScrollBtn.classList.toggle('active', this.autoScroll);
        
        if (this.autoScroll) {
            this.threadLog.scrollTop = this.threadLog.scrollHeight;
        }
    }
    
    updateStats() {
        this.activeThreadsSpan.textContent = this.threads.size;
        this.totalThreadsSpan.textContent = this.totalThreadsCreated;
        this.maxDepthReachedSpan.textContent = this.maxDepthReached === Infinity ? '∞' : this.maxDepthReached;
        
        // Calculate processing rate
        if (this.startTime && this.processingRateSpan) {
            const elapsed = (Date.now() - this.startTime) / 1000;
            const rate = elapsed > 0 ? Math.round(this.totalThreadsCreated / elapsed) : 0;
            this.processingRateSpan.textContent = `${rate}/sec`;
        }
        
        // Update settings display
        if (this.maxDepthInput) {
            const depthDisplay = this.maxDepthInput.value === '0' ? '∞' : this.maxDepthInput.value;
            this.maxDepthInput.setAttribute('title', `Current: ${depthDisplay}`);
        }
        
        if (this.maxThreadsInput) {
            const threadsDisplay = this.maxThreadsInput.value === '0' ? '∞' : this.maxThreadsInput.value;
            this.maxThreadsInput.setAttribute('title', `Current: ${threadsDisplay}`);
        }
    }
    
    updateRuntime() {
        if (!this.startTime) return;
        
        const elapsed = Date.now() - this.startTime;
        const minutes = Math.floor(elapsed / 60000);
        const seconds = Math.floor((elapsed % 60000) / 1000);
        
        this.runtimeSpan.textContent = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    }
}

// Initialize the application when the page loads
document.addEventListener('DOMContentLoaded', () => {
    const simulator = new ThreadSimulator();
    
    // Add some welcome messages
    simulator.log('Thread Visualization Dashboard initialized', 'SYSTEM', 0);
    simulator.log('Click Start to begin thread simulation', 'SYSTEM', 0);
    simulator.log('Use controls to adjust speed and limits', 'SYSTEM', 0);
    
    // Add keyboard shortcuts
    document.addEventListener('keydown', (e) => {
        if (e.key === ' ') { // Spacebar to start/pause
            e.preventDefault();
            if (simulator.isRunning) {
                simulator.pause();
            } else {
                simulator.start();
            }
        } else if (e.key === 'r' || e.key === 'R') { // R to reset
            if (e.ctrlKey || e.metaKey) {
                e.preventDefault();
                simulator.reset();
            }
        } else if (e.key === 't' || e.key === 'T') { // T to toggle view
            if (e.ctrlKey || e.metaKey) {
                e.preventDefault();
                simulator.switchView(simulator.currentView === 'tree' ? 'log' : 'tree');
            }
        }
    });
    
    // Add resize handler for responsive visualization
    window.addEventListener('resize', () => {
        // Recalculate positions if needed
        if (simulator.currentView === 'tree') {
            // Could implement position recalculation here
        }
    });
    
    // Add visibility change handler to pause when tab is not visible
    document.addEventListener('visibilitychange', () => {
        if (document.hidden && simulator.isRunning) {
            // Optionally pause when tab is not visible to save resources
            // simulator.pause();
        }
    });
});

// Add some utility functions for enhanced functionality
function exportThreadData() {
    // Could implement data export functionality
    console.log('Export functionality could be implemented here');
}

function importThreadConfig() {
    // Could implement configuration import
    console.log('Import functionality could be implemented here');
}

// Performance monitoring
let frameCount = 0;
let lastTime = performance.now();

function monitorPerformance() {
    frameCount++;
    const currentTime = performance.now();
    
    if (currentTime - lastTime >= 1000) {
        const fps = Math.round((frameCount * 1000) / (currentTime - lastTime));
        // Could display FPS in UI if needed
        frameCount = 0;
        lastTime = currentTime;
    }
    
    requestAnimationFrame(monitorPerformance);
}

// Start performance monitoring
requestAnimationFrame(monitorPerformance);