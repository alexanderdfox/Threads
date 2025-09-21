class CollatzSimulator {
    constructor() {
        this.isRunning = false;
        this.calculations = new Map();
        this.currentNumber = 1;
        this.numbersTested = 0;
        this.longestSequence = 0;
        this.highestPeak = 0;
        this.startTime = null;
        this.runtimeInterval = null;
        this.mainInterval = null;
        this.cleanupIntervalId = null;
        
        // GPU acceleration for Collatz calculations
        this.gpuAccelerated = false;
        this.gl = null;
        this.collatzComputeShader = null;
        this.workers = [];
        this.batchSize = 2048; // Larger batches for Collatz calculations
        this.processingQueue = [];
        this.pendingBatches = new Map();
        
        // Records
        this.records = {
            mostSteps: { number: 0, steps: 0 },
            highestPeak: { number: 0, peak: 0 },
            fastestToOne: { number: 0, steps: Infinity }
        };
        
        // Settings
        this.speed = 500;
        this.maxNumber = Infinity; // Infinite number exploration
        this.maxDepth = Infinity; // Infinite thread depth
        this.showSequences = true;
        
        // Performance settings for infinite mode
        this.maxVisualizationNodes = 200;
        this.maxLogEntries = 500;
        this.cleanupInterval = 5000; // More frequent cleanup for infinite mode
        
        // Graph data
        this.graphData = [];
        
        // UI elements
        this.initializeElements();
        this.setupEventListeners();
        this.initializeCollatzGPU();
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
        this.maxNumberInput = document.getElementById('maxNumber');
        this.maxDepthInput = document.getElementById('maxDepth');
        this.showSequencesInput = document.getElementById('showSequences');
        
        // Stats
        this.accelerationTypeSpan = document.getElementById('accelerationType');
        this.activeCalculationsSpan = document.getElementById('activeCalculations');
        this.numbersTestedSpan = document.getElementById('numbersTested');
        this.longestSequenceSpan = document.getElementById('longestSequence');
        this.highestPeakSpan = document.getElementById('highestPeak');
        this.currentNumberSpan = document.getElementById('currentNumber');
        this.processingRateSpan = document.getElementById('processingRate');
        this.runtimeSpan = document.getElementById('runtime');
        
        // Records
        this.recordStepsSpan = document.getElementById('recordSteps');
        this.recordPeakSpan = document.getElementById('recordPeak');
        this.recordFastestSpan = document.getElementById('recordFastest');
        
        // Visualization
        this.collatzTree = document.getElementById('collatzTree');
        this.collatzLog = document.getElementById('collatzLog');
        this.collatzGraph = document.getElementById('collatzGraph');
        this.treeViewBtn = document.getElementById('treeViewBtn');
        this.graphViewBtn = document.getElementById('graphViewBtn');
        this.logViewBtn = document.getElementById('logViewBtn');
        this.treeView = document.getElementById('treeView');
        this.graphView = document.getElementById('graphView');
        this.logView = document.getElementById('logView');
        
        // Controls
        this.clearLogBtn = document.getElementById('clearLogBtn');
        this.clearGraphBtn = document.getElementById('clearGraphBtn');
        this.autoScrollBtn = document.getElementById('autoScrollBtn');
        this.exportLogBtn = document.getElementById('exportLogBtn');
        this.exportGraphBtn = document.getElementById('exportGraphBtn');
        
        this.autoScroll = true;
        this.graphContext = this.collatzGraph?.getContext('2d');
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
        
        this.maxNumberInput.addEventListener('change', (e) => {
            const value = parseInt(e.target.value);
            this.maxNumber = value === 0 ? Infinity : value;
        });
        
        this.maxDepthInput.addEventListener('change', (e) => {
            const value = parseInt(e.target.value);
            this.maxDepth = value === 0 ? Infinity : value;
        });
        
        this.showSequencesInput.addEventListener('change', (e) => {
            this.showSequences = e.target.checked;
        });
        
        // View controls
        this.treeViewBtn.addEventListener('click', () => this.switchView('tree'));
        this.graphViewBtn.addEventListener('click', () => this.switchView('graph'));
        this.logViewBtn.addEventListener('click', () => this.switchView('log'));
        
        // Action controls
        this.clearLogBtn?.addEventListener('click', () => this.clearLog());
        this.clearGraphBtn?.addEventListener('click', () => this.clearGraph());
        this.autoScrollBtn?.addEventListener('click', () => this.toggleAutoScroll());
        this.exportLogBtn?.addEventListener('click', () => this.exportLog());
        this.exportGraphBtn?.addEventListener('click', () => this.exportGraph());
    }
    
    initializeCollatzGPU() {
        try {
            // Create a canvas for WebGL compute
            const canvas = document.createElement('canvas');
            canvas.width = 1;
            canvas.height = 1;
            this.gl = canvas.getContext('webgl2-compute', {antialias: false});
            
            if (!this.gl) {
                console.log('WebGL2 Compute not supported, falling back to Web Workers for Collatz');
                this.initializeCollatzWorkers();
                return;
            }
            
            // Create compute shader for parallel Collatz calculations
            const collatzComputeSource = `#version 310 es
                layout(local_size_x = 64, local_size_y = 1, local_size_z = 1) in;
                
                layout(std430, binding = 0) restrict readonly buffer InputBuffer {
                    uint inputNumbers[];
                };
                
                layout(std430, binding = 1) restrict writeonly buffer OutputBuffer {
                    uint outputData[]; // steps, maxValue pairs
                };
                
                void calculateCollatz(uint n, uint index) {
                    uint current = n;
                    uint steps = 0u;
                    uint maxValue = n;
                    
                    // Calculate Collatz sequence
                    while (current != 1u && steps < 10000u) {
                        if (current % 2u == 0u) {
                            current = current / 2u;
                        } else {
                            current = current * 3u + 1u;
                        }
                        steps++;
                        maxValue = max(maxValue, current);
                        
                        // Prevent overflow
                        if (current > 100000000u) break;
                    }
                    
                    // Store results: steps and maxValue
                    outputData[index * 2u] = steps;
                    outputData[index * 2u + 1u] = maxValue;
                }
                
                void main() {
                    uint index = gl_GlobalInvocationID.x;
                    if (index >= inputNumbers.length()) return;
                    
                    uint number = inputNumbers[index];
                    calculateCollatz(number, index);
                }
            `;
            
            this.collatzComputeShader = this.createComputeShader(collatzComputeSource);
            if (this.collatzComputeShader) {
                this.gpuAccelerated = true;
                console.log('🚀 GPU acceleration enabled for Collatz calculations!');
                this.updateAccelerationType();
            } else {
                this.initializeCollatzWorkers();
            }
            
        } catch (error) {
            console.log('Collatz GPU initialization failed, using Web Workers:', error);
            this.initializeCollatzWorkers();
        }
    }
    
    createComputeShader(source) {
        if (!this.gl) return null;
        
        const shader = this.gl.createShader(this.gl.COMPUTE_SHADER);
        this.gl.shaderSource(shader, source);
        this.gl.compileShader(shader);
        
        if (!this.gl.getShaderParameter(shader, this.gl.COMPILE_STATUS)) {
            console.error('Collatz compute shader compilation failed:', this.gl.getShaderInfoLog(shader));
            return null;
        }
        
        const program = this.gl.createProgram();
        this.gl.attachShader(program, shader);
        this.gl.linkProgram(program);
        
        if (!this.gl.getProgramParameter(program, this.gl.LINK_STATUS)) {
            console.error('Collatz compute shader program linking failed:', this.gl.getProgramInfoLog(program));
            return null;
        }
        
        return program;
    }
    
    initializeCollatzWorkers() {
        const numWorkers = navigator.hardwareConcurrency || 4;
        
        for (let i = 0; i < numWorkers; i++) {
            const workerCode = `
                function calculateCollatzSequence(n) {
                    const sequence = [n];
                    let current = n;
                    let steps = 0;
                    let maxValue = n;
                    
                    while (current !== 1 && steps < 10000) {
                        if (current % 2 === 0) {
                            current = current / 2;
                        } else {
                            current = current * 3 + 1;
                        }
                        sequence.push(current);
                        maxValue = Math.max(maxValue, current);
                        steps++;
                        
                        // Prevent infinite loops
                        if (current > 100000000) break;
                    }
                    
                    return {
                        sequence: sequence,
                        steps: steps,
                        maxValue: maxValue
                    };
                }
                
                self.onmessage = function(e) {
                    const { numbers, batchId } = e.data;
                    const results = [];
                    
                    for (const number of numbers) {
                        const result = calculateCollatzSequence(number);
                        results.push({
                            number: number,
                            steps: result.steps,
                            maxValue: result.maxValue,
                            sequence: result.sequence.slice(0, 20) // Limit sequence length for performance
                        });
                    }
                    
                    self.postMessage({ results, batchId });
                };
            `;
            
            const blob = new Blob([workerCode], { type: 'application/javascript' });
            const worker = new Worker(URL.createObjectURL(blob));
            
            worker.onmessage = (e) => {
                this.handleCollatzWorkerResult(e.data);
            };
            
            this.workers.push(worker);
        }
        
        console.log(`🧵 Initialized ${numWorkers} Web Workers for parallel Collatz calculations`);
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
    
    calculateCollatzBatch(numbers) {
        if (this.gpuAccelerated && this.collatzComputeShader) {
            return this.calculateCollatzGPU(numbers);
        } else {
            return this.calculateCollatzWorkers(numbers);
        }
    }
    
    calculateCollatzGPU(numbers) {
        if (!this.gl || !this.collatzComputeShader) return [];
        
        const inputData = new Uint32Array(numbers);
        const outputSize = numbers.length * 2; // steps and maxValue for each number
        
        // Create buffers
        const inputBuffer = this.gl.createBuffer();
        const outputBuffer = this.gl.createBuffer();
        
        // Upload input data
        this.gl.bindBuffer(this.gl.SHADER_STORAGE_BUFFER, inputBuffer);
        this.gl.bufferData(this.gl.SHADER_STORAGE_BUFFER, inputData, this.gl.STATIC_READ);
        this.gl.bindBufferBase(this.gl.SHADER_STORAGE_BUFFER, 0, inputBuffer);
        
        // Create output buffer
        this.gl.bindBuffer(this.gl.SHADER_STORAGE_BUFFER, outputBuffer);
        this.gl.bufferData(this.gl.SHADER_STORAGE_BUFFER, outputSize * 4, this.gl.STATIC_READ);
        this.gl.bindBufferBase(this.gl.SHADER_STORAGE_BUFFER, 1, outputBuffer);
        
        // Dispatch compute shader
        this.gl.useProgram(this.collatzComputeShader);
        const workGroupSize = Math.ceil(numbers.length / 64);
        this.gl.dispatchCompute(workGroupSize, 1, 1);
        this.gl.memoryBarrier(this.gl.SHADER_STORAGE_BARRIER_BIT);
        
        // Read results
        this.gl.bindBuffer(this.gl.SHADER_STORAGE_BUFFER, outputBuffer);
        const rawResults = new Uint32Array(outputSize);
        this.gl.getBufferSubData(this.gl.SHADER_STORAGE_BUFFER, 0, rawResults);
        
        // Process results
        const results = [];
        for (let i = 0; i < numbers.length; i++) {
            const steps = rawResults[i * 2];
            const maxValue = rawResults[i * 2 + 1];
            
            results.push({
                number: numbers[i],
                steps: steps,
                maxValue: maxValue,
                sequence: [], // GPU doesn't store full sequence for performance
                gpuProcessed: true
            });
        }
        
        // Cleanup
        this.gl.deleteBuffer(inputBuffer);
        this.gl.deleteBuffer(outputBuffer);
        
        return results;
    }
    
    calculateCollatzWorkers(numbers) {
        const batchId = Date.now();
        const batchSize = Math.ceil(numbers.length / this.workers.length);
        
        // Store batch info for result handling
        this.pendingBatches.set(batchId, {
            expectedResults: numbers.length,
            receivedResults: 0,
            results: []
        });
        
        for (let i = 0; i < this.workers.length; i++) {
            const start = i * batchSize;
            const end = Math.min(start + batchSize, numbers.length);
            const numberBatch = numbers.slice(start, end);
            
            if (numberBatch.length > 0) {
                this.workers[i].postMessage({
                    numbers: numberBatch,
                    batchId: batchId
                });
            }
        }
        
        return batchId; // Return batch ID for async handling
    }
    
    handleCollatzWorkerResult(data) {
        const { results, batchId } = data;
        const batch = this.pendingBatches.get(batchId);
        
        if (!batch) return;
        
        batch.results.push(...results);
        batch.receivedResults += results.length;
        
        // Check if batch is complete
        if (batch.receivedResults >= batch.expectedResults) {
            this.processBatchResults(batch.results);
            this.pendingBatches.delete(batchId);
        }
    }
    
    processBatchResults(results) {
        for (const result of results) {
            // Update records
            this.updateRecords(result.number, result);
            
            // Add to graph data
            this.graphData.push({ 
                x: result.number, 
                y: result.steps, 
                peak: result.maxValue 
            });
            
            // Create calculation entry
            const calcId = `Collatz-${result.number}-${Date.now()}`;
            const calculation = {
                id: calcId,
                number: result.number,
                name: `Collatz-${result.number}`,
                depth: 0,
                result: {
                    sequence: result.sequence || [],
                    steps: result.steps,
                    maxValue: result.maxValue
                },
                createdAt: Date.now(),
                processed: true
            };
            
            this.calculations.set(calcId, calculation);
            this.numbersTested++;
            this.longestSequence = Math.max(this.longestSequence, result.steps);
            this.highestPeak = Math.max(this.highestPeak, result.maxValue);
            
            // Log significant results
            if (result.steps > 100 || result.maxValue > result.number * 100) {
                this.log(`⭐ Number ${result.number}: ${result.steps} steps, peak ${result.maxValue}`, `Collatz-${result.number}`, 0);
            }
            
            this.visualizeCalculation(calculation);
        }
        
        this.updateStats();
        this.updateGraph();
    }
    
    calculateCollatzSequence(n) {
        const sequence = [n];
        let current = n;
        let steps = 0;
        let maxValue = n;
        
        while (current !== 1) {
            if (current % 2 === 0) {
                current = current / 2;
            } else {
                current = current * 3 + 1;
            }
            sequence.push(current);
            maxValue = Math.max(maxValue, current);
            steps++;
        }
        
        return {
            sequence: sequence,
            steps: steps,
            maxValue: maxValue
        };
    }
    
    start() {
        if (this.isRunning) return;
        
        this.isRunning = true;
        this.startTime = Date.now();
        this.startBtn.disabled = true;
        this.pauseBtn.disabled = false;
        
        // Start runtime counter
        this.runtimeInterval = setInterval(() => this.updateRuntime(), 1000);
        
        // Start cleanup interval
        this.cleanupIntervalId = setInterval(() => this.performCleanup(), this.cleanupInterval);
        
        // Start main calculation loop
        this.createMainCalculationLoop();
        
        const accelerationType = this.gpuAccelerated ? 'GPU (WebGL Compute)' : `CPU (${this.workers.length} Workers)`;
        this.log(`Collatz exploration started - Infinite Mode (${accelerationType})`, 'SYSTEM', 0);
        this.log(`Max Number: ${this.maxNumber === Infinity ? '∞' : this.maxNumber}, Max Depth: ${this.maxDepth === Infinity ? '∞' : this.maxDepth}`, 'SYSTEM', 0);
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
        
        // Clear all pending calculation timeouts
        this.calculations.forEach(calc => {
            if (calc.timeout) {
                clearTimeout(calc.timeout);
            }
        });
        
        this.log('System paused', 'SYSTEM', 0);
    }
    
    reset() {
        this.pause();
        
        this.calculations.clear();
        this.currentNumber = 1;
        this.numbersTested = 0;
        this.longestSequence = 0;
        this.highestPeak = 0;
        this.startTime = null;
        this.graphData = [];
        
        // Reset records
        this.records = {
            mostSteps: { number: 0, steps: 0 },
            highestPeak: { number: 0, peak: 0 },
            fastestToOne: { number: 0, steps: Infinity }
        };
        
        // Clear visualizations
        this.collatzTree.innerHTML = '';
        this.collatzLog.innerHTML = '';
        this.clearGraph();
        
        this.updateStats();
        this.log('System reset', 'SYSTEM', 0);
    }
    
    createMainCalculationLoop() {
        if (!this.isRunning) return;
        
        // Create batch of numbers for GPU/parallel processing
        const batchSize = this.gpuAccelerated ? Math.min(this.batchSize, 1024) : Math.min(this.workers.length * 16, 64);
        const numbers = [];
        
        for (let i = 0; i < batchSize; i++) {
            numbers.push(this.currentNumber);
            this.currentNumber++;
        }
        
        // Process batch with GPU or Workers
        if (this.gpuAccelerated) {
            const results = this.calculateCollatzGPU(numbers);
            this.processBatchResults(results);
        } else {
            this.calculateCollatzWorkers(numbers);
        }
        
        // Schedule next batch
        this.mainInterval = setTimeout(() => this.createMainCalculationLoop(), this.speed);
    }
    
    createCollatzCalculation(number, calcName, depth) {
        if (!this.isRunning) return;
        
        const calcId = `${calcName}-${Date.now()}-${Math.random()}`;
        const result = this.calculateCollatzSequence(number);
        
        const calculation = {
            id: calcId,
            number: number,
            name: calcName,
            depth: depth,
            result: result,
            createdAt: Date.now(),
            timeout: null
        };
        
        this.calculations.set(calcId, calculation);
        this.numbersTested++;
        this.longestSequence = Math.max(this.longestSequence, result.steps);
        this.highestPeak = Math.max(this.highestPeak, result.maxValue);
        
        // Update records
        this.updateRecords(number, result);
        
        // Add to graph data
        this.graphData.push({ x: number, y: result.steps, peak: result.maxValue });
        
        this.log(`Number ${number}: ${result.steps} steps, peak ${result.maxValue}`, calcName, depth);
        this.visualizeCalculation(calculation);
        this.updateStats();
        this.updateGraph();
        
        // Create child calculations (infinite depth mode)
        if (this.isRunning) {
            calculation.timeout = setTimeout(() => {
                if (this.isRunning && this.calculations.has(calcId)) {
                    // Create related calculations based on Collatz results
                    this.createRelatedCalculations(calculation);
                    
                    // Remove this calculation after creating children
                    setTimeout(() => {
                        this.removeCalculation(calcId);
                    }, this.speed * 2);
                }
            }, this.speed + Math.random() * this.speed);
        }
    }
    
    createRelatedCalculations(parentCalc) {
        const result = parentCalc.result;
        const number = parentCalc.number;
        const depth = parentCalc.depth;
        
        // Strategy 1: If long sequence, try nearby numbers
        if (result.steps > 20) {
            const nearbyNumber = number + Math.floor(Math.random() * 10) + 1;
            this.createCollatzCalculation(nearbyNumber, parentCalc.name + '*', depth + 1);
        }
        
        // Strategy 2: If high peak, try doubling
        if (result.maxValue > number * 10) {
            this.createCollatzCalculation(number * 2, parentCalc.name + '**', depth + 1);
        }
        
        // Strategy 3: Always try next sequential number (infinite exploration)
        this.createCollatzCalculation(number + 1, parentCalc.name + '***', depth + 1);
    }
    
    updateRecords(number, result) {
        // Most steps
        if (result.steps > this.records.mostSteps.steps) {
            this.records.mostSteps = { number: number, steps: result.steps };
        }
        
        // Highest peak
        if (result.maxValue > this.records.highestPeak.peak) {
            this.records.highestPeak = { number: number, peak: result.maxValue };
        }
        
        // Fastest to one (least steps)
        if (result.steps < this.records.fastestToOne.steps) {
            this.records.fastestToOne = { number: number, steps: result.steps };
        }
    }
    
    removeCalculation(calcId) {
        if (this.calculations.has(calcId)) {
            this.calculations.delete(calcId);
            
            // Remove from visualization
            const node = document.querySelector(`[data-calc-id="${calcId}"]`);
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
        const now = Date.now();
        const calculationsToRemove = [];
        
        this.calculations.forEach((calc, id) => {
            // Clean up calculations older than 20 seconds in infinite mode
            if (now - calc.createdAt > 20000) {
                calculationsToRemove.push(id);
            }
        });
        
        calculationsToRemove.forEach(id => this.removeCalculation(id));
        
        // Limit visualization nodes
        const nodes = this.collatzTree.children;
        if (nodes.length > this.maxVisualizationNodes) {
            const nodesToRemove = Array.from(nodes).slice(0, nodes.length - this.maxVisualizationNodes);
            nodesToRemove.forEach(node => {
                if (node.parentNode) {
                    node.parentNode.removeChild(node);
                }
            });
        }
        
        // Limit log entries
        const logEntries = this.collatzLog.children;
        if (logEntries.length > this.maxLogEntries) {
            const entriesToRemove = Array.from(logEntries).slice(0, logEntries.length - this.maxLogEntries);
            entriesToRemove.forEach(entry => {
                if (entry.parentNode) {
                    entry.parentNode.removeChild(entry);
                }
            });
        }
    }
    
    visualizeCalculation(calculation) {
        if (this.currentView !== 'tree') return;
        
        const node = document.createElement('div');
        const steps = calculation.result.steps;
        
        // Determine node class based on sequence length
        let sequenceClass = 'sequence-short';
        if (steps > 100) sequenceClass = 'sequence-extreme';
        else if (steps > 50) sequenceClass = 'sequence-long';
        else if (steps > 10) sequenceClass = 'sequence-medium';
        
        node.className = `collatz-node ${sequenceClass}`;
        node.textContent = `${calculation.number} (${steps})`;
        node.setAttribute('data-calc-id', calculation.id);
        
        // Position calculation
        const x = 50 + (calculation.depth * 180) + (Math.random() * 80 - 40);
        const y = 50 + (this.calculations.size % 12) * 50 + (Math.random() * 20 - 10);
        
        node.style.left = `${x}px`;
        node.style.top = `${y}px`;
        
        // Add click event for details
        node.addEventListener('click', () => {
            this.showCalculationDetails(calculation);
        });
        
        this.collatzTree.appendChild(node);
    }
    
    showCalculationDetails(calculation) {
        const result = calculation.result;
        const sequenceStr = this.showSequences ? 
            `\nSequence: ${result.sequence.slice(0, 15).join(' → ')}${result.sequence.length > 15 ? '...' : ''}` : '';
        
        const details = `
Collatz Calculation Details:
- Starting Number: ${calculation.number}
- Steps to reach 1: ${result.steps}
- Maximum value reached: ${result.maxValue}
- Thread Depth: ${calculation.depth}
- Calculated: ${new Date(calculation.createdAt).toLocaleTimeString()}${sequenceStr}
        `.trim();
        
        alert(details);
    }
    
    updateGraph() {
        if (!this.graphContext || this.currentView !== 'graph') return;
        
        const canvas = this.collatzGraph;
        const ctx = this.graphContext;
        
        // Clear canvas
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        
        if (this.graphData.length === 0) return;
        
        // Find data ranges
        const maxX = Math.max(...this.graphData.map(d => d.x));
        const maxY = Math.max(...this.graphData.map(d => d.y));
        
        const padding = 40;
        const graphWidth = canvas.width - 2 * padding;
        const graphHeight = canvas.height - 2 * padding;
        
        // Draw axes
        ctx.strokeStyle = '#e2e8f0';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(padding, padding);
        ctx.lineTo(padding, canvas.height - padding);
        ctx.lineTo(canvas.width - padding, canvas.height - padding);
        ctx.stroke();
        
        // Draw data points
        ctx.fillStyle = '#667eea';
        this.graphData.forEach(point => {
            const x = padding + (point.x / maxX) * graphWidth;
            const y = canvas.height - padding - (point.y / maxY) * graphHeight;
            
            ctx.beginPath();
            ctx.arc(x, y, 2, 0, 2 * Math.PI);
            ctx.fill();
        });
        
        // Draw labels
        ctx.fillStyle = '#4a5568';
        ctx.font = '12px Inter';
        ctx.fillText('0', padding - 10, canvas.height - padding + 15);
        ctx.fillText(maxX.toString(), canvas.width - padding, canvas.height - padding + 15);
        ctx.fillText('0', padding - 25, canvas.height - padding);
        ctx.fillText(maxY.toString(), padding - 25, padding);
    }
    
    log(message, calcName, depth) {
        const timestamp = new Date().toLocaleTimeString();
        const entry = document.createElement('div');
        entry.className = 'log-entry';
        
        entry.innerHTML = `
            <span class="timestamp">[${timestamp}]</span>
            <span class="calc-name">${calcName}</span>
            <span class="depth">(depth: ${depth})</span>
            - ${message}
        `;
        
        this.collatzLog.appendChild(entry);
        
        if (this.autoScroll) {
            this.collatzLog.scrollTop = this.collatzLog.scrollHeight;
        }
    }
    
    switchView(view) {
        this.currentView = view;
        
        // Hide all views
        this.treeView.style.display = 'none';
        this.graphView.style.display = 'none';
        this.logView.style.display = 'none';
        
        // Remove active class from all buttons
        this.treeViewBtn.classList.remove('active');
        this.graphViewBtn.classList.remove('active');
        this.logViewBtn.classList.remove('active');
        
        // Show selected view
        if (view === 'tree') {
            this.treeView.style.display = 'block';
            this.treeViewBtn.classList.add('active');
        } else if (view === 'graph') {
            this.graphView.style.display = 'block';
            this.graphViewBtn.classList.add('active');
            this.updateGraph();
        } else if (view === 'log') {
            this.logView.style.display = 'block';
            this.logViewBtn.classList.add('active');
        }
    }
    
    clearLog() {
        this.collatzLog.innerHTML = '';
        this.log('Log cleared', 'SYSTEM', 0);
    }
    
    clearGraph() {
        this.graphData = [];
        this.updateGraph();
    }
    
    toggleAutoScroll() {
        this.autoScroll = !this.autoScroll;
        this.autoScrollBtn.classList.toggle('active', this.autoScroll);
        
        if (this.autoScroll) {
            this.collatzLog.scrollTop = this.collatzLog.scrollHeight;
        }
    }
    
    exportLog() {
        const logText = Array.from(this.collatzLog.children)
            .map(entry => entry.textContent)
            .join('\n');
        
        const blob = new Blob([logText], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `collatz_log_${new Date().toISOString().slice(0, 19)}.txt`;
        a.click();
        URL.revokeObjectURL(url);
    }
    
    exportGraph() {
        const csvContent = 'Number,Steps,MaxValue\n' + 
            this.graphData.map(d => `${d.x},${d.y},${d.peak}`).join('\n');
        
        const blob = new Blob([csvContent], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `collatz_data_${new Date().toISOString().slice(0, 19)}.csv`;
        a.click();
        URL.revokeObjectURL(url);
    }
    
    updateStats() {
        this.activeCalculationsSpan.textContent = this.calculations.size;
        this.numbersTestedSpan.textContent = this.numbersTested;
        this.longestSequenceSpan.textContent = this.longestSequence;
        this.highestPeakSpan.textContent = this.highestPeak;
        this.currentNumberSpan.textContent = this.currentNumber;
        
        // Calculate processing rate
        if (this.startTime && this.processingRateSpan) {
            const elapsed = (Date.now() - this.startTime) / 1000;
            const rate = elapsed > 0 ? Math.round(this.numbersTested / elapsed) : 0;
            this.processingRateSpan.textContent = `${rate}/sec`;
        }
        
        // Update settings display with infinity symbols
        if (this.maxNumberInput) {
            const numberDisplay = this.maxNumberInput.value === '0' ? '∞' : this.maxNumberInput.value;
            this.maxNumberInput.setAttribute('title', `Current: ${numberDisplay}`);
        }
        
        if (this.maxDepthInput) {
            const depthDisplay = this.maxDepthInput.value === '0' ? '∞' : this.maxDepthInput.value;
            this.maxDepthInput.setAttribute('title', `Current: ${depthDisplay}`);
        }
        
        // Update records
        this.recordStepsSpan.textContent = this.records.mostSteps.steps > 0 ? 
            `${this.records.mostSteps.number} (${this.records.mostSteps.steps} steps)` : '-';
        this.recordPeakSpan.textContent = this.records.highestPeak.peak > 0 ? 
            `${this.records.highestPeak.number} (${this.records.highestPeak.peak})` : '-';
        this.recordFastestSpan.textContent = this.records.fastestToOne.steps < Infinity ? 
            `${this.records.fastestToOne.number} (${this.records.fastestToOne.steps} steps)` : '-';
    }
    
    updateRuntime() {
        if (!this.startTime) return;
        
        const elapsed = Date.now() - this.startTime;
        const minutes = Math.floor(elapsed / 60000);
        const seconds = Math.floor((elapsed % 60000) / 1000);
        
        this.runtimeSpan.textContent = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    }
}

// Initialize the Collatz application
document.addEventListener('DOMContentLoaded', () => {
    const simulator = new CollatzSimulator();
    
    // Add welcome messages
    simulator.log('Collatz Conjecture Dashboard initialized', 'SYSTEM', 0);
    simulator.log('Click Start to begin exploring the 3n+1 problem', 'SYSTEM', 0);
    simulator.log('Each number spawns related calculations in separate threads', 'SYSTEM', 0);
    
    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
        if (e.key === ' ') {
            e.preventDefault();
            if (simulator.isRunning) {
                simulator.pause();
            } else {
                simulator.start();
            }
        } else if (e.key === 'r' || e.key === 'R') {
            if (e.ctrlKey || e.metaKey) {
                e.preventDefault();
                simulator.reset();
            }
        } else if (e.key === 't' || e.key === 'T') {
            if (e.ctrlKey || e.metaKey) {
                e.preventDefault();
                const views = ['tree', 'graph', 'log'];
                const currentIndex = views.indexOf(simulator.currentView);
                const nextView = views[(currentIndex + 1) % views.length];
                simulator.switchView(nextView);
            }
        }
    });
});
