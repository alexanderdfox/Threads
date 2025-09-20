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
        
        // Records
        this.records = {
            mostSteps: { number: 0, steps: 0 },
            highestPeak: { number: 0, peak: 0 },
            fastestToOne: { number: 0, steps: Infinity }
        };
        
        // Settings
        this.speed = 500;
        this.maxNumber = 1000;
        this.maxDepth = 3;
        this.showSequences = true;
        
        // Performance settings
        this.maxVisualizationNodes = 150;
        this.maxLogEntries = 300;
        this.cleanupInterval = 10000;
        
        // Graph data
        this.graphData = [];
        
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
        this.maxNumberInput = document.getElementById('maxNumber');
        this.maxDepthInput = document.getElementById('maxDepth');
        this.showSequencesInput = document.getElementById('showSequences');
        
        // Stats
        this.activeCalculationsSpan = document.getElementById('activeCalculations');
        this.numbersTestedSpan = document.getElementById('numbersTested');
        this.longestSequenceSpan = document.getElementById('longestSequence');
        this.highestPeakSpan = document.getElementById('highestPeak');
        this.currentNumberSpan = document.getElementById('currentNumber');
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
            this.maxNumber = parseInt(e.target.value);
        });
        
        this.maxDepthInput.addEventListener('change', (e) => {
            this.maxDepth = parseInt(e.target.value);
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
        
        this.log(`Collatz exploration started - Max Number: ${this.maxNumber}, Max Depth: ${this.maxDepth}`, 'SYSTEM', 0);
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
        if (!this.isRunning || this.currentNumber > this.maxNumber) return;
        
        // Create calculation for current number
        this.createCollatzCalculation(this.currentNumber, `Collatz-${this.currentNumber}`, 0);
        this.currentNumber++;
        
        // Schedule next calculation
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
        
        // Create child calculations if within depth limit
        if (depth < this.maxDepth && this.isRunning) {
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
        } else {
            // Remove calculation after some time
            calculation.timeout = setTimeout(() => {
                this.removeCalculation(calcId);
            }, this.speed * 3);
        }
    }
    
    createRelatedCalculations(parentCalc) {
        const result = parentCalc.result;
        const number = parentCalc.number;
        const depth = parentCalc.depth;
        
        // Strategy 1: If long sequence, try nearby numbers
        if (result.steps > 20) {
            const nearbyNumber = number + Math.floor(Math.random() * 10) + 1;
            if (nearbyNumber <= this.maxNumber) {
                this.createCollatzCalculation(nearbyNumber, parentCalc.name + '*', depth + 1);
            }
        }
        
        // Strategy 2: If high peak, try doubling
        if (result.maxValue > number * 10 && number * 2 <= this.maxNumber) {
            this.createCollatzCalculation(number * 2, parentCalc.name + '**', depth + 1);
        }
        
        // Strategy 3: Try next sequential number
        if (number + 1 <= this.maxNumber) {
            this.createCollatzCalculation(number + 1, parentCalc.name + '***', depth + 1);
        }
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
            if (now - calc.createdAt > 30000) {
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
