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
        this.activeThreadsSpan = document.getElementById('activeThreads');
        this.totalThreadsSpan = document.getElementById('totalThreads');
        this.maxDepthReachedSpan = document.getElementById('maxDepthReached');
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
        
        this.log(`System started - Infinite Mode (Max Depth: ${this.maxDepth === Infinity ? '∞' : this.maxDepth}, Max Threads: ${this.maxThreads === Infinity ? '∞' : this.maxThreads})`, 'SYSTEM', 0);
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
        
        // Always create new threads (infinite mode)
        const threadName = `Thread-${this.threadCounter}`;
        this.createThread(threadName, 0);
        this.threadCounter++;
        
        // Schedule next main thread creation
        this.mainInterval = setTimeout(() => this.createMainThreadLoop(), this.speed);
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