import Foundation
import Dispatch
import Metal
import MetalKit
import simd
import Accelerate
import os

// Advanced Metal compute shader for infinite Collatz exploration with optimizations
let infiniteMetalShaderSource = """
#include <metal_stdlib>
using namespace metal;

struct CollatzResult {
    ulong steps;
    ulong maxValue;
    ulong originalNumber;
    ulong convergencePattern; // New: track convergence patterns
};

struct CollatzStats {
    uint totalCalculations;
    uint recordSteps;
    uint recordNumber;
    float averageSteps;
};

// Optimized Collatz computation with unrolled loops
kernel void infiniteCollatzCompute(device const ulong* inputNumbers [[buffer(0)]],
                                  device CollatzResult* results [[buffer(1)]],
                                  device atomic_uint* globalStats [[buffer(2)]],
                                  constant ulong& maxSteps [[buffer(3)]],
                                  uint index [[thread_position_in_grid]],
                                  uint threadgroup_position_in_grid [[threadgroup_position_in_grid]],
                                  uint thread_position_in_threadgroup [[thread_position_in_threadgroup]]) {
    
    ulong n = inputNumbers[index];
    ulong current = n;
    ulong steps = 0;
    ulong maxValue = n;
    ulong convergencePattern = 0;
    
    // Early exit for known small values
    if (n <= 1) {
        results[index] = {0, n, n, 0};
        return;
    }
    
    // Optimized Collatz computation with loop unrolling
    while (current != 1 && steps < maxSteps) {
        // Unroll loop for better performance (process 4 iterations at once when possible)
        for (uint unroll = 0; unroll < 4 && current != 1 && steps < maxSteps; unroll++) {
            if (current % 2 == 0) {
                current = current >> 1;  // Bit shift is faster than division
                convergencePattern |= (1UL << (steps % 64)); // Track even steps
            } else {
                current = current * 3 + 1;
                // Check for potential overflow (much higher limit for ulong)
                if (current > 10000000000000000UL || current < n) break;
            }
            steps++;
            maxValue = max(maxValue, current);
        }
        
        // Prevent infinite loops
        if (current > 10000000000000000UL || steps > maxSteps) break;
    }
    
    results[index].steps = steps;
    results[index].maxValue = maxValue;
    results[index].originalNumber = n;
    results[index].convergencePattern = convergencePattern;
    
    // Update global statistics atomically
    atomic_fetch_add_explicit(&globalStats[0], 1, memory_order_relaxed); // total calculations
    
    // Update record if this is a new record (use atomic compare-and-swap)
    uint currentRecord = atomic_load_explicit(&globalStats[1], memory_order_relaxed);
    if (uint(steps) > currentRecord) {
        uint stepsUint = uint(steps);
        atomic_compare_exchange_weak_explicit(&globalStats[1], &currentRecord, stepsUint, 
                                            memory_order_relaxed, memory_order_relaxed);
        if (stepsUint > currentRecord) {
            atomic_store_explicit(&globalStats[2], uint(n), memory_order_relaxed); // record number
        }
    }
}

// Specialized kernel for SIMD-width processing (process multiple numbers per thread)
kernel void vectorizedCollatzCompute(device const ulong4* inputVectors [[buffer(0)]],
                                    device CollatzResult* results [[buffer(1)]],
                                    device atomic_uint* globalStats [[buffer(2)]],
                                    constant ulong& maxSteps [[buffer(3)]],
                                    uint index [[thread_position_in_grid]]) {
    
    ulong4 numbers = inputVectors[index];
    
    // Process 4 numbers simultaneously using SIMD
    for (uint i = 0; i < 4; i++) {
        ulong n = numbers[i];
        ulong current = n;
        ulong steps = 0;
        ulong maxValue = n;
        
        while (current != 1 && steps < maxSteps) {
            if (current % 2 == 0) {
                current = current >> 1;
            } else {
                current = current * 3 + 1;
                if (current > 10000000000000000UL) break;
            }
            steps++;
            maxValue = max(maxValue, current);
        }
        
        uint resultIndex = index * 4 + i;
        results[resultIndex].steps = steps;
        results[resultIndex].maxValue = maxValue;
        results[resultIndex].originalNumber = n;
        results[resultIndex].convergencePattern = 0;
        
        atomic_fetch_add_explicit(&globalStats[0], 1, memory_order_relaxed);
    }
}
"""

struct InfiniteCollatzResult {
    let steps: UInt64
    let maxValue: UInt64
    let originalNumber: UInt64
    let convergencePattern: UInt64
}

// Extension for array chunking
extension Array {
    func chunked(into size: Int) -> [[Element]] {
        return stride(from: 0, to: count, by: size).map {
            Array(self[$0..<Swift.min($0 + size, count)])
        }
    }
}

// SIMD-optimized Collatz calculation using Swift's SIMD types
struct SIMDCollatzProcessor {
    static func calculateCollatzSIMD4(_ numbers: SIMD4<UInt32>) -> [InfiniteCollatzResult] {
        var results: [InfiniteCollatzResult] = []
        
        // Process 4 numbers simultaneously using SIMD operations
        var current = numbers
        var steps = SIMD4<UInt32>(0, 0, 0, 0)
        var maxValues = numbers
        let ones = SIMD4<UInt32>(1, 1, 1, 1)
        
        // Simplified vectorized Collatz computation (avoiding complex SIMD masking)
        for _ in 0..<10000 {
            let notOne = current .!= ones
            if !any(notOne) { break }
            
            // Process each element individually but in parallel
            for i in 0..<4 {
                if current[i] != 1 && current[i] <= UInt32.max / 4 {
                    if current[i] % 2 == 0 {
                        current[i] = current[i] / 2
                    } else {
                        current[i] = current[i] * 3 + 1
                    }
                    steps[i] += 1
                    maxValues[i] = max(maxValues[i], current[i])
                }
            }
            
            // Check for overflow
            let overflow = current .> SIMD4<UInt32>(UInt32.max / 4, UInt32.max / 4, UInt32.max / 4, UInt32.max / 4)
            if any(overflow) { break }
        }
        
        // Convert SIMD results back to individual results
        for i in 0..<4 {
            results.append(InfiniteCollatzResult(
                steps: UInt64(steps[i]),
                maxValue: UInt64(maxValues[i]),
                originalNumber: UInt64(numbers[i]),
                convergencePattern: 0
            ))
        }
        
        return results
    }
    
    static func calculateCollatzSIMD8(_ numbers: [UInt64]) -> [InfiniteCollatzResult] {
        var results: [InfiniteCollatzResult] = []
        
        // Process numbers in groups of 8 using SIMD8
        let chunkSize = 8
        for chunk in numbers.chunked(into: chunkSize) {
            var paddedChunk = Array(chunk)
            while paddedChunk.count < chunkSize {
                paddedChunk.append(1) // Pad with 1s (quick to compute)
            }
            
            // Split into two SIMD4 operations
            let first4 = SIMD4<UInt32>(UInt32(paddedChunk[0]), UInt32(paddedChunk[1]), UInt32(paddedChunk[2]), UInt32(paddedChunk[3]))
            let second4 = SIMD4<UInt32>(UInt32(paddedChunk[4]), UInt32(paddedChunk[5]), UInt32(paddedChunk[6]), UInt32(paddedChunk[7]))
            
            results.append(contentsOf: calculateCollatzSIMD4(first4))
            results.append(contentsOf: calculateCollatzSIMD4(second4))
        }
        
        return Array(results.prefix(numbers.count))
    }
}

// GCD-based concurrent processor for CPU optimization
class GCDCollatzProcessor {
    private let concurrentQueue: DispatchQueue
    private let processingGroup: DispatchGroup
    private let semaphore: DispatchSemaphore
    let maxConcurrentOperations: Int
    
    init() {
        let cpuCount = ProcessInfo.processInfo.activeProcessorCount
        self.maxConcurrentOperations = max(cpuCount * 2, 8) // Use 2x CPU cores
        
        self.concurrentQueue = DispatchQueue(
            label: "collatz.concurrent.processing",
            qos: .userInteractive,
            attributes: .concurrent
        )
        self.processingGroup = DispatchGroup()
        self.semaphore = DispatchSemaphore(value: maxConcurrentOperations)
        
        print("🧵 GCD Processor initialized with \(maxConcurrentOperations) concurrent operations")
    }
    
    func processNumbers(_ numbers: [UInt64], completion: @escaping ([InfiniteCollatzResult]) -> Void) {
        let chunkSize = max(numbers.count / maxConcurrentOperations, 100)
        let chunks = numbers.chunked(into: chunkSize)
        var allResults: [InfiniteCollatzResult] = []
        let resultsLock = NSLock()
        
        let startTime = CFAbsoluteTimeGetCurrent()
        
        for chunk in chunks {
            processingGroup.enter()
            semaphore.wait()
            
            concurrentQueue.async { [weak self] in
                defer {
                    self?.semaphore.signal()
                    self?.processingGroup.leave()
                }
                
                // Use SIMD for chunk processing
                let chunkResults = SIMDCollatzProcessor.calculateCollatzSIMD8(chunk)
                
                resultsLock.lock()
                allResults.append(contentsOf: chunkResults)
                resultsLock.unlock()
            }
        }
        
        processingGroup.notify(queue: .main) {
            let processingTime = CFAbsoluteTimeGetCurrent() - startTime
            let rate = Double(numbers.count) / processingTime
            print("🧵 GCD processed \(numbers.count) numbers in \(String(format: "%.2f", processingTime))s (\(String(format: "%.0f", rate))/sec)")
            
            completion(allResults.sorted { $0.originalNumber < $1.originalNumber })
        }
    }
}

class HybridInfiniteCollatzExplorer {
    private let device: MTLDevice
    private let commandQueue: MTLCommandQueue
    private let computePipelineState: MTLComputePipelineState
    private let vectorizedPipelineState: MTLComputePipelineState
    private let gcdProcessor: GCDCollatzProcessor
    private var mostStepsRecord: (number: UInt64, steps: UInt64) = (0, 0)
    private let recordLock = NSLock()
    private var totalProcessed: UInt64 = 0
    private let startTime = CFAbsoluteTimeGetCurrent()
    
    // Performance tracking
    private var metalPerformance: (totalTime: Double, totalNumbers: Int) = (0, 0)
    private var gcdPerformance: (totalTime: Double, totalNumbers: Int) = (0, 0)
    private var simdPerformance: (totalTime: Double, totalNumbers: Int) = (0, 0)
    
    // Adaptive processing thresholds
    private let metalThreshold = 1000    // Use Metal for batches > 1000
    private let gcdThreshold = 100       // Use GCD for batches > 100
    private let simdThreshold = 10       // Use SIMD for batches > 10
    
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
            
            // Create standard compute pipeline
            guard let kernelFunction = library.makeFunction(name: "infiniteCollatzCompute") else {
                print("Failed to create kernel function")
                return nil
            }
            self.computePipelineState = try device.makeComputePipelineState(function: kernelFunction)
            
            // Create vectorized compute pipeline
            guard let vectorizedFunction = library.makeFunction(name: "vectorizedCollatzCompute") else {
                print("Failed to create vectorized kernel function")
                return nil
            }
            self.vectorizedPipelineState = try device.makeComputePipelineState(function: vectorizedFunction)
            
        } catch {
            print("Failed to create compute pipeline state: \(error)")
            return nil
        }
        
        // Initialize GCD processor
        self.gcdProcessor = GCDCollatzProcessor()
        
        print("🚀 Hybrid Collatz Explorer initialized with Metal GPU + GCD + SIMD")
        print("   GPU: \(device.name)")
        print("   Max threads per threadgroup: \(computePipelineState.maxTotalThreadsPerThreadgroup)")
        print("   GCD concurrent operations: \(maxConcurrentOperations)")
        print("   Processing thresholds: Metal ≥\(metalThreshold), GCD ≥\(gcdThreshold), SIMD ≥\(simdThreshold)")
    }
    
    // Intelligent processing method that chooses the best approach
    func processNumbers(_ numbers: [UInt64]) -> [InfiniteCollatzResult] {
        let count = numbers.count
        let startTime = CFAbsoluteTimeGetCurrent()
        
        var results: [InfiniteCollatzResult] = []
        
        if count >= metalThreshold {
            // Use Metal GPU for large batches
            let range = "\(numbers.first ?? 0)-\(numbers.last ?? 0)"
            print("⚡ Using Metal GPU for \(count) numbers (range: \(range))")
            results = processWithMetal(numbers)
            
            let processingTime = CFAbsoluteTimeGetCurrent() - startTime
            metalPerformance.totalTime += processingTime
            metalPerformance.totalNumbers += count
            
        } else if count >= gcdThreshold {
            // Use GCD for medium batches
            let range = "\(numbers.first ?? 0)-\(numbers.last ?? 0)"
            print("🧵 Using GCD + SIMD for \(count) numbers (range: \(range))")
            let semaphore = DispatchSemaphore(value: 0)
            
            gcdProcessor.processNumbers(numbers) { gcdResults in
                results = gcdResults
                semaphore.signal()
            }
            semaphore.wait()
            
            let processingTime = CFAbsoluteTimeGetCurrent() - startTime
            gcdPerformance.totalTime += processingTime
            gcdPerformance.totalNumbers += count
            
        } else if count >= simdThreshold {
            // Use SIMD for small-medium batches
            let range = "\(numbers.first ?? 0)-\(numbers.last ?? 0)"
            print("🔢 Using SIMD for \(count) numbers (range: \(range))")
            results = SIMDCollatzProcessor.calculateCollatzSIMD8(numbers)
            
            let processingTime = CFAbsoluteTimeGetCurrent() - startTime
            simdPerformance.totalTime += processingTime
            simdPerformance.totalNumbers += count
            
        } else {
            // Use sequential processing for very small batches
            let range = "\(numbers.first ?? 0)-\(numbers.last ?? 0)"
            print("🔄 Using sequential processing for \(count) numbers (range: \(range))")
            results = processSequential(numbers)
        }
        
        // Update records
        updateRecords(results)
        totalProcessed += UInt64(count)
        
        let totalTime = CFAbsoluteTimeGetCurrent() - startTime
        let rate = Double(count) / totalTime
        
        print("   Batch completed in \(String(format: "%.3f", totalTime))s (\(String(format: "%.0f", rate))/sec)")
        
        return results
    }
    
    private func processWithMetal(_ numbers: [UInt64]) -> [InfiniteCollatzResult] {
        // Decide between standard and vectorized kernel
        let useVectorized = numbers.count >= 4000
        
        if useVectorized {
            return processWithVectorizedMetal(numbers)
        } else {
            return processWithStandardMetal(numbers)
        }
    }
    
    private func processWithStandardMetal(_ numbers: [UInt64]) -> [InfiniteCollatzResult] {
        let inputData = numbers
        let maxSteps: UInt64 = 100000
        
        // Create buffers
        guard let inputBuffer = device.makeBuffer(bytes: inputData, length: inputData.count * MemoryLayout<UInt64>.size, options: []),
              let outputBuffer = device.makeBuffer(length: inputData.count * MemoryLayout<InfiniteCollatzResult>.size, options: []),
              let statsBuffer = device.makeBuffer(length: 4 * MemoryLayout<UInt32>.size, options: []),
              let maxStepsBuffer = device.makeBuffer(bytes: [maxSteps], length: MemoryLayout<UInt64>.size, options: []) else {
            return []
        }
        
        // Initialize stats buffer
        let statsPointer = statsBuffer.contents().bindMemory(to: UInt32.self, capacity: 4)
        statsPointer[0] = 0  // total calculations
        statsPointer[1] = 0  // record steps
        statsPointer[2] = 0  // record number
        statsPointer[3] = 0  // reserved
        
        guard let commandBuffer = commandQueue.makeCommandBuffer(),
              let computeEncoder = commandBuffer.makeComputeCommandEncoder() else {
            return []
        }
        
        computeEncoder.setComputePipelineState(computePipelineState)
        computeEncoder.setBuffer(inputBuffer, offset: 0, index: 0)
        computeEncoder.setBuffer(outputBuffer, offset: 0, index: 1)
        computeEncoder.setBuffer(statsBuffer, offset: 0, index: 2)
        computeEncoder.setBuffer(maxStepsBuffer, offset: 0, index: 3)
        
        let threadsPerThreadgroup = MTLSize(width: min(inputData.count, computePipelineState.maxTotalThreadsPerThreadgroup), height: 1, depth: 1)
        let numThreadgroups = MTLSize(width: (inputData.count + threadsPerThreadgroup.width - 1) / threadsPerThreadgroup.width, height: 1, depth: 1)
        
        computeEncoder.dispatchThreadgroups(numThreadgroups, threadsPerThreadgroup: threadsPerThreadgroup)
        computeEncoder.endEncoding()
        
        commandBuffer.commit()
        commandBuffer.waitUntilCompleted()
        
        // Read results
        let resultPointer = outputBuffer.contents().bindMemory(to: InfiniteCollatzResult.self, capacity: inputData.count)
        let results = Array(UnsafeBufferPointer(start: resultPointer, count: inputData.count))
        
        // Read global stats
        let finalStats = Array(UnsafeBufferPointer(start: statsPointer, count: 4))
        if UInt64(finalStats[1]) > mostStepsRecord.steps {
            recordLock.lock()
            if UInt64(finalStats[1]) > mostStepsRecord.steps {
                mostStepsRecord = (number: UInt64(finalStats[2]), steps: UInt64(finalStats[1]))
                print("🏆 NEW GPU RECORD! Number: \(finalStats[2]) took \(finalStats[1]) steps")
            }
            recordLock.unlock()
        }
        
        return results
    }
    
    private func processWithVectorizedMetal(_ numbers: [UInt64]) -> [InfiniteCollatzResult] {
        // Pad numbers to multiple of 4 for SIMD processing
        var paddedNumbers = numbers
        while paddedNumbers.count % 4 != 0 {
            paddedNumbers.append(1)
        }
        
        // Convert to SIMD4 vectors
        var simdVectors: [SIMD4<UInt32>] = []
        for i in stride(from: 0, to: paddedNumbers.count, by: 4) {
            let vector = SIMD4<UInt32>(UInt32(paddedNumbers[i]), UInt32(paddedNumbers[i+1]), UInt32(paddedNumbers[i+2]), UInt32(paddedNumbers[i+3]))
            simdVectors.append(vector)
        }
        
        let maxSteps: UInt64 = 100000
        
        // Create buffers
        guard let inputBuffer = device.makeBuffer(bytes: simdVectors, length: simdVectors.count * MemoryLayout<SIMD4<UInt32>>.size, options: []),
              let outputBuffer = device.makeBuffer(length: paddedNumbers.count * MemoryLayout<InfiniteCollatzResult>.size, options: []),
              let statsBuffer = device.makeBuffer(length: 4 * MemoryLayout<UInt32>.size, options: []),
              let maxStepsBuffer = device.makeBuffer(bytes: [maxSteps], length: MemoryLayout<UInt64>.size, options: []) else {
            return []
        }
        
        guard let commandBuffer = commandQueue.makeCommandBuffer(),
              let computeEncoder = commandBuffer.makeComputeCommandEncoder() else {
            return []
        }
        
        computeEncoder.setComputePipelineState(vectorizedPipelineState)
        computeEncoder.setBuffer(inputBuffer, offset: 0, index: 0)
        computeEncoder.setBuffer(outputBuffer, offset: 0, index: 1)
        computeEncoder.setBuffer(statsBuffer, offset: 0, index: 2)
        computeEncoder.setBuffer(maxStepsBuffer, offset: 0, index: 3)
        
        let threadsPerThreadgroup = MTLSize(width: min(simdVectors.count, vectorizedPipelineState.maxTotalThreadsPerThreadgroup), height: 1, depth: 1)
        let numThreadgroups = MTLSize(width: (simdVectors.count + threadsPerThreadgroup.width - 1) / threadsPerThreadgroup.width, height: 1, depth: 1)
        
        computeEncoder.dispatchThreadgroups(numThreadgroups, threadsPerThreadgroup: threadsPerThreadgroup)
        computeEncoder.endEncoding()
        
        commandBuffer.commit()
        commandBuffer.waitUntilCompleted()
        
        // Read results
        let resultPointer = outputBuffer.contents().bindMemory(to: InfiniteCollatzResult.self, capacity: paddedNumbers.count)
        let allResults = Array(UnsafeBufferPointer(start: resultPointer, count: paddedNumbers.count))
        
        // Return only original count (remove padding)
        return Array(allResults.prefix(numbers.count))
    }
    
    private func processSequential(_ numbers: [UInt64]) -> [InfiniteCollatzResult] {
        return numbers.map { number in
            var current = number
            var steps: UInt64 = 0
            var maxValue = number
            
            while current != 1 && steps < 100000 {
                if current % 2 == 0 {
                    current = current / 2
                } else {
                    current = current * 3 + 1
                }
                steps += 1
                maxValue = max(maxValue, current)
                
                if current > 10000000000000000 { break }
            }
            
            return InfiniteCollatzResult(
                steps: steps,
                maxValue: maxValue,
                originalNumber: number,
                convergencePattern: 0
            )
        }
    }
    
    private func updateRecords(_ results: [InfiniteCollatzResult]) {
        recordLock.lock()
        defer { recordLock.unlock() }
        
        for result in results {
            // Only print new records
            if result.steps > mostStepsRecord.steps {
                mostStepsRecord = (number: result.originalNumber, steps: result.steps)
                print("🏆 NEW RECORD! Number: \(result.originalNumber) took \(result.steps) steps (max value: \(result.maxValue))")
                
                let elapsed = CFAbsoluteTimeGetCurrent() - startTime
                let rate = Double(totalProcessed) / elapsed
                print("   Processed \(totalProcessed) numbers in \(String(format: "%.1f", elapsed))s (avg \(String(format: "%.0f", rate))/sec)")
            }
        }
    }
    
    func printPerformanceStats() {
        let elapsed = CFAbsoluteTimeGetCurrent() - startTime
        let totalRate = Double(totalProcessed) / elapsed
        
        print("\n📊 Performance Statistics:")
        print("   Total processed: \(totalProcessed) numbers in \(String(format: "%.1f", elapsed))s")
        print("   Overall rate: \(String(format: "%.0f", totalRate)) numbers/sec")
        print("   Current record: \(mostStepsRecord.number) with \(mostStepsRecord.steps) steps")
        
        if metalPerformance.totalNumbers > 0 {
            let metalRate = Double(metalPerformance.totalNumbers) / metalPerformance.totalTime
            print("   Metal GPU: \(metalPerformance.totalNumbers) numbers, \(String(format: "%.0f", metalRate)) numbers/sec")
        }
        
        if gcdPerformance.totalNumbers > 0 {
            let gcdRate = Double(gcdPerformance.totalNumbers) / gcdPerformance.totalTime
            print("   GCD+SIMD: \(gcdPerformance.totalNumbers) numbers, \(String(format: "%.0f", gcdRate)) numbers/sec")
        }
        
        if simdPerformance.totalNumbers > 0 {
            let simdRate = Double(simdPerformance.totalNumbers) / simdPerformance.totalTime
            print("   SIMD: \(simdPerformance.totalNumbers) numbers, \(String(format: "%.0f", simdRate)) numbers/sec")
        }
    }
    
    func startInfiniteExploration() {
        var currentStart: UInt64 = 1
        let initialBatchSize = 5000
        var adaptiveBatchSize = initialBatchSize
        
        print("🚀 Starting Hybrid GPU+GCD+SIMD Infinite Collatz Exploration...")
        print("🎯 Intelligently choosing optimal processing method per batch")
        print("⚡ Metal GPU + Grand Central Dispatch + SIMD Vectorization")
        print("Press Ctrl+C to stop\n")
        
        // Performance monitoring
        var lastStatsTime = CFAbsoluteTimeGetCurrent()
        var lastDisplayTime = CFAbsoluteTimeGetCurrent()
        
        while true {
            let currentRange = currentStart..<(currentStart + UInt64(adaptiveBatchSize))
            let numbers = Array(currentRange)
            
            let results = processNumbers(numbers)
            
            // Print progress every 25k numbers with current range info
            if totalProcessed % 25000 == 0 {
                let elapsed = CFAbsoluteTimeGetCurrent() - startTime
                let rate = Double(totalProcessed) / elapsed
                print("📊 Progress: \(totalProcessed) numbers processed in \(String(format: "%.1f", elapsed))s")
                print("   Overall rate: \(String(format: "%.0f", rate)) numbers/sec")
                print("   Current record: \(mostStepsRecord.number) with \(mostStepsRecord.steps) steps")
                print("   Currently exploring: \(currentRange.lowerBound) to \(currentRange.upperBound)")
                print("   Batch size: \(adaptiveBatchSize) (adaptive)")
            }
            
            // Print real-time processing updates every 2 seconds
            let currentTime = CFAbsoluteTimeGetCurrent()
            if currentTime - lastDisplayTime > 2.0 {
                let currentNumber = currentRange.upperBound - 1
                let elapsed = currentTime - startTime
                let rate = Double(totalProcessed) / elapsed
                print("🔍 Currently at number \(currentNumber) | Rate: \(String(format: "%.0f", rate))/sec | Record: \(mostStepsRecord.number) (\(mostStepsRecord.steps) steps)")
                lastDisplayTime = currentTime
            }
            
            // Print detailed performance stats every 5 minutes
            if currentTime - lastStatsTime > 300 {
                printPerformanceStats()
                lastStatsTime = currentTime
            }
            
            // Adaptive strategy generation based on results
            let nextBatch = generateAdaptiveBatch(currentRange: currentRange, batchSize: adaptiveBatchSize, results: results)
            currentStart = nextBatch.first ?? (currentRange.upperBound + 1)
            
            // Dynamic batch sizing optimization
            let avgSteps = results.map { Double($0.steps) }.reduce(0, +) / Double(results.count)
            
            if avgSteps > 50 && adaptiveBatchSize < 8192 {
                adaptiveBatchSize = min(adaptiveBatchSize + 512, 8192) // Increase for interesting regions
            } else if avgSteps < 20 && adaptiveBatchSize > 1000 {
                adaptiveBatchSize = max(adaptiveBatchSize - 256, 1000) // Decrease for boring regions
            }
        }
    }
    
    private func generateAdaptiveBatch(currentRange: Range<UInt64>, batchSize: Int, results: [InfiniteCollatzResult]) -> [UInt64] {
        var nextNumbers: [UInt64] = []
        
        // Strategy 1: Sequential exploration (40% of batch)
        let sequentialCount = batchSize * 40 / 100
        let sequentialStart = currentRange.upperBound
        nextNumbers.append(contentsOf: sequentialStart..<(sequentialStart + UInt64(sequentialCount)))
        
        // Strategy 2: Explore around high-step numbers (30% of batch)
        let interestingCount = batchSize * 30 / 100
        let interestingResults = results.filter { $0.steps > 75 }.sorted { $0.steps > $1.steps }.prefix(interestingCount / 4)
        for result in interestingResults {
            let base = result.originalNumber
            let variations = [
                base * 2, base * 3, base + UInt64.random(in: 1...200),
                base - min(base / 2, UInt64.random(in: 1...100))
            ]
            nextNumbers.append(contentsOf: variations.prefix(4))
        }
        
        // Strategy 3: Power-of-2 related numbers (15% of batch)
        let powerCount = batchSize * 15 / 100
        let powerBase = currentRange.upperBound
        for i in 0..<powerCount {
            let power = UInt64(1 << (i % 20)) // Powers of 2 up to 2^20
            nextNumbers.append(powerBase + power + UInt64(i))
        }
        
        // Strategy 4: Random high-range exploration (15% of batch)
        let randomCount = batchSize - nextNumbers.count
        let randomBase = currentRange.upperBound + UInt64.random(in: 10000...100000)
        for i in 0..<randomCount {
            nextNumbers.append(randomBase + UInt64(i))
        }
        
        return Array(nextNumbers.prefix(batchSize))
    }
    
    private var maxConcurrentOperations: Int {
        return gcdProcessor.maxConcurrentOperations
    }
}

// Fallback CPU implementation using GCD and SIMD
class CPUInfiniteCollatzExplorer {
    private let gcdProcessor: GCDCollatzProcessor
    private var mostStepsRecord: (number: UInt64, steps: UInt64) = (0, 0)
    private let recordLock = NSLock()
    private var totalProcessed: UInt64 = 0
    private let startTime = CFAbsoluteTimeGetCurrent()
    
    init() {
        self.gcdProcessor = GCDCollatzProcessor()
    }
    
    func startInfiniteExploration() {
        print("🚀 Starting CPU-based infinite Collatz exploration with GCD + SIMD...")
        print("🎯 Searching for numbers with the most steps to reach 1")
        print("🧵 Using multi-threaded CPU processing with SIMD vectorization")
        print("Press Ctrl+C to stop\n")
        
        var currentStart: UInt64 = 1
        let batchSize = 1000
        
        while true {
            let numbers = Array(currentStart..<(currentStart + UInt64(batchSize)))
            let semaphore = DispatchSemaphore(value: 0)
            
             gcdProcessor.processNumbers(numbers) { [weak self] results in
                 self?.updateRecords(results)
                 self?.totalProcessed += UInt64(results.count)
                 
                 if self?.totalProcessed ?? 0 % 10000 == 0 {
                     let elapsed = CFAbsoluteTimeGetCurrent() - (self?.startTime ?? 0)
                     let rate = Double(self?.totalProcessed ?? 0) / elapsed
                     print("📊 Progress: \(self?.totalProcessed ?? 0) numbers processed, current record: \(self?.mostStepsRecord.number ?? 0) (\(self?.mostStepsRecord.steps ?? 0) steps)")
                     print("   Rate: \(String(format: "%.0f", rate)) numbers/sec")
                     print("   Currently at number: \(numbers.last ?? 0)")
                 }
                 
                 semaphore.signal()
             }
            
            semaphore.wait()
            currentStart += UInt64(batchSize)
        }
    }
    
    private func updateRecords(_ results: [InfiniteCollatzResult]) {
        recordLock.lock()
        defer { recordLock.unlock() }
        
        for result in results {
            if result.steps > mostStepsRecord.steps {
                mostStepsRecord = (number: result.originalNumber, steps: result.steps)
                let elapsed = CFAbsoluteTimeGetCurrent() - startTime
                let rate = Double(totalProcessed) / elapsed
                print("🏆 NEW RECORD! Number: \(result.originalNumber) took \(result.steps) steps (max value: \(result.maxValue))")
                print("   Processed \(totalProcessed) numbers in \(String(format: "%.1f", elapsed))s (avg \(String(format: "%.0f", rate))/sec)")
            }
        }
    }
}

// Main execution
print("🔍 Detecting optimal processing configuration...")

if let hybridExplorer = HybridInfiniteCollatzExplorer() {
    hybridExplorer.startInfiniteExploration()
} else {
    print("GPU not available, falling back to CPU exploration with GCD + SIMD...")
    let cpuExplorer = CPUInfiniteCollatzExplorer()
    cpuExplorer.startInfiniteExploration()
}
