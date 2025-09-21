import Foundation
import Dispatch
import Metal
import MetalKit

// Metal compute shader for infinite Collatz exploration
let infiniteMetalShaderSource = """
#include <metal_stdlib>
using namespace metal;

struct CollatzResult {
    uint steps;
    uint maxValue;
    uint originalNumber;
};

kernel void infiniteCollatzCompute(device const uint* inputNumbers [[buffer(0)]],
                                  device CollatzResult* results [[buffer(1)]],
                                  uint index [[thread_position_in_grid]]) {
    uint n = inputNumbers[index];
    uint current = n;
    uint steps = 0;
    uint maxValue = n;
    
    // Allow more steps for infinite exploration
    while (current != 1 && steps < 100000) {
        if (current % 2 == 0) {
            current = current / 2;
        } else {
            current = current * 3 + 1;
        }
        steps++;
        maxValue = max(maxValue, current);
        
        // Prevent overflow
        if (current > 1000000000) break;
    }
    
    results[index].steps = steps;
    results[index].maxValue = maxValue;
    results[index].originalNumber = n;
}
"""

struct InfiniteCollatzResult {
    let steps: UInt32
    let maxValue: UInt32
    let originalNumber: UInt32
}

class GPUInfiniteCollatzExplorer {
    private let device: MTLDevice
    private let commandQueue: MTLCommandQueue
    private let computePipelineState: MTLComputePipelineState
    private var mostStepsRecord: (number: UInt32, steps: UInt32) = (0, 0)
    private let recordLock = NSLock()
    private var totalProcessed: UInt64 = 0
    private let startTime = CFAbsoluteTimeGetCurrent()
    
    init?() {
        guard let device = MTLCreateSystemDefaultDevice() else {
            print("Metal is not supported on this device")
            return nil
        }
        
        self.device = device
        
        guard let commandQueue = device.makeCommandQueue() else {
            print("Failed to create command queue")
            return nil
        }
        
        self.commandQueue = commandQueue
        
        do {
            let library = try device.makeLibrary(source: infiniteMetalShaderSource, options: nil)
            let kernelFunction = library.makeFunction(name: "infiniteCollatzCompute")
            self.computePipelineState = try device.makeComputePipelineState(function: kernelFunction!)
        } catch {
            print("Failed to create compute pipeline state: \(error)")
            return nil
        }
    }
    
    func exploreCollatzBatch(numbers: [UInt32]) -> [InfiniteCollatzResult] {
        let inputBuffer = device.makeBuffer(bytes: numbers, length: numbers.count * MemoryLayout<UInt32>.size, options: [])!
        let outputBuffer = device.makeBuffer(length: numbers.count * MemoryLayout<InfiniteCollatzResult>.size, options: [])!
        
        let commandBuffer = commandQueue.makeCommandBuffer()!
        let computeEncoder = commandBuffer.makeComputeCommandEncoder()!
        
        computeEncoder.setComputePipelineState(computePipelineState)
        computeEncoder.setBuffer(inputBuffer, offset: 0, index: 0)
        computeEncoder.setBuffer(outputBuffer, offset: 0, index: 1)
        
        let threadsPerGroup = MTLSize(width: min(numbers.count, computePipelineState.maxTotalThreadsPerThreadgroup), height: 1, depth: 1)
        let numGroups = MTLSize(width: (numbers.count + threadsPerGroup.width - 1) / threadsPerGroup.width, height: 1, depth: 1)
        
        computeEncoder.dispatchThreadgroups(numGroups, threadsPerThreadgroup: threadsPerGroup)
        computeEncoder.endEncoding()
        
        commandBuffer.commit()
        commandBuffer.waitUntilCompleted()
        
        let resultPointer = outputBuffer.contents().bindMemory(to: InfiniteCollatzResult.self, capacity: numbers.count)
        let results = Array(UnsafeBufferPointer(start: resultPointer, count: numbers.count))
        
        return results
    }
    
    func checkForRecords(_ results: [InfiniteCollatzResult]) {
        recordLock.lock()
        defer { recordLock.unlock() }
        
        for result in results {
            if result.steps > mostStepsRecord.steps {
                mostStepsRecord = (number: result.originalNumber, steps: result.steps)
                let currentTime = CFAbsoluteTimeGetCurrent()
                let elapsed = currentTime - startTime
                let rate = Double(totalProcessed) / elapsed
                
                print("🏆 NEW RECORD! Number: \(result.originalNumber) took \(result.steps) steps (max value: \(result.maxValue))")
                print("   Processed \(totalProcessed) numbers in \(String(format: "%.1f", elapsed))s (avg \(String(format: "%.0f", rate))/sec)")
            }
        }
    }
    
    func generateNextBatch(currentRange: Range<UInt32>, batchSize: Int, results: [InfiniteCollatzResult]) -> [UInt32] {
        var nextNumbers: [UInt32] = []
        
        // Strategy 1: Continue sequential exploration
        let sequentialStart = currentRange.upperBound
        let sequentialEnd = sequentialStart + UInt32(batchSize / 2)
        nextNumbers.append(contentsOf: sequentialStart..<sequentialEnd)
        
        // Strategy 2: Explore around interesting numbers (high step counts)
        let interestingResults = results.filter { $0.steps > 50 }.sorted { $0.steps > $1.steps }.prefix(batchSize / 4)
        for result in interestingResults {
            let base = result.originalNumber
            let variations = [
                base * 2, base * 3, base + UInt32.random(in: 1...100),
                base - min(base / 2, UInt32.random(in: 1...50))
            ]
            nextNumbers.append(contentsOf: variations.prefix(2))
        }
        
        // Strategy 3: Random exploration in higher ranges
        let remainingSlots = batchSize - nextNumbers.count
        let randomBase = sequentialEnd + UInt32.random(in: 0...10000)
        for i in 0..<remainingSlots {
            nextNumbers.append(randomBase + UInt32(i))
        }
        
        return Array(nextNumbers.prefix(batchSize))
    }
    
    func startInfiniteExploration() {
        var currentStart: UInt32 = 1
        let initialBatchSize = 2048
        var adaptiveBatchSize = initialBatchSize
        
        print("🚀 Starting GPU-accelerated infinite Collatz exploration...")
        print("🎯 Searching for numbers with the most steps to reach 1")
        print("⚡ Using GPU parallel processing with adaptive batch sizing")
        print("Press Ctrl+C to stop\n")
        
        while true {
            let currentRange = currentStart..<(currentStart + UInt32(adaptiveBatchSize))
            let numbers = Array(currentRange)
            
            let results = exploreCollatzBatch(numbers: numbers)
            checkForRecords(results)
            
            totalProcessed += UInt64(adaptiveBatchSize)
            
            // Print progress every 100k numbers
            if totalProcessed % 100000 == 0 {
                let elapsed = CFAbsoluteTimeGetCurrent() - startTime
                let rate = Double(totalProcessed) / elapsed
                print("📊 Progress: \(totalProcessed) numbers processed in \(String(format: "%.1f", elapsed))s (avg \(String(format: "%.0f", rate))/sec)")
                print("   Current record: \(mostStepsRecord.number) with \(mostStepsRecord.steps) steps")
                print("   Exploring range: \(currentRange.lowerBound) - \(currentRange.upperBound)")
            }
            
            // Generate next batch using adaptive strategy
            let nextBatch = generateNextBatch(currentRange: currentRange, batchSize: adaptiveBatchSize, results: results)
            currentStart = nextBatch.first ?? (currentRange.upperBound + 1)
            
            // Adaptive batch sizing based on performance
            let highStepResults = results.filter { $0.steps > 100 }
            if !highStepResults.isEmpty && adaptiveBatchSize < 4096 {
                adaptiveBatchSize = min(adaptiveBatchSize + 256, 4096) // Increase batch size when finding interesting numbers
            } else if highStepResults.isEmpty && adaptiveBatchSize > 512 {
                adaptiveBatchSize = max(adaptiveBatchSize - 128, 512) // Decrease batch size when not finding much
            }
        }
    }
}

// Fallback CPU implementation for infinite exploration
class CPUInfiniteCollatzExplorer {
    private var mostStepsRecord: (number: UInt32, steps: UInt32) = (0, 0)
    private let recordLock = NSLock()
    private var totalProcessed: UInt64 = 0
    private let startTime = CFAbsoluteTimeGetCurrent()
    
    func collatzSteps(n: UInt32) -> (steps: UInt32, maxValue: UInt32) {
        var current = n
        var steps: UInt32 = 0
        var maxValue = n
        
        while current != 1 && steps < 100000 {
            if current % 2 == 0 {
                current = current / 2
            } else {
                current = current * 3 + 1
            }
            steps += 1
            maxValue = max(maxValue, current)
            
            if current > 1000000000 { break }
        }
        
        return (steps: steps, maxValue: maxValue)
    }
    
    func startInfiniteExploration() {
        print("🚀 Starting CPU-based infinite Collatz exploration...")
        print("🎯 Searching for numbers with the most steps to reach 1")
        print("🧵 Using multi-threaded CPU processing")
        print("Press Ctrl+C to stop\n")
        
        let queue = DispatchQueue.global(qos: .userInteractive)
        let semaphore = DispatchSemaphore(value: 100) // Limit concurrent threads
        
        var i: UInt32 = 1
        while true {
            semaphore.wait()
            queue.async { [self] in
                defer { semaphore.signal() }
                
                let result = collatzSteps(n: i)
                
                recordLock.lock()
                if result.steps > mostStepsRecord.steps {
                    mostStepsRecord = (number: i, steps: result.steps)
                    let elapsed = CFAbsoluteTimeGetCurrent() - startTime
                    let rate = Double(totalProcessed) / elapsed
                    print("🏆 NEW RECORD! Number: \(i) took \(result.steps) steps (max value: \(result.maxValue))")
                    print("   Processed \(totalProcessed) numbers in \(String(format: "%.1f", elapsed))s (avg \(String(format: "%.0f", rate))/sec)")
                }
                
                totalProcessed += 1
                
                if totalProcessed % 10000 == 0 {
                    let elapsed = CFAbsoluteTimeGetCurrent() - startTime
                    let rate = Double(totalProcessed) / elapsed
                    print("📊 Progress: \(totalProcessed) numbers processed, current record: \(mostStepsRecord.number) (\(mostStepsRecord.steps) steps)")
                }
                recordLock.unlock()
            }
            i += 1
        }
    }
}

// Main execution
if let gpuExplorer = GPUInfiniteCollatzExplorer() {
    gpuExplorer.startInfiniteExploration()
} else {
    print("GPU not available, falling back to CPU exploration...")
    let cpuExplorer = CPUInfiniteCollatzExplorer()
    cpuExplorer.startInfiniteExploration()
}
