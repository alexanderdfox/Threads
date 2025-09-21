import Foundation
import Dispatch
import Metal
import MetalKit

// Metal compute shader source code
let metalShaderSource = """
#include <metal_stdlib>
using namespace metal;

struct CollatzResult {
    uint steps;
    uint maxValue;
};

kernel void collatzCompute(device const uint* inputNumbers [[buffer(0)]],
                          device CollatzResult* results [[buffer(1)]],
                          uint index [[thread_position_in_grid]]) {
    uint n = inputNumbers[index];
    uint current = n;
    uint steps = 0;
    uint maxValue = n;
    
    while (current != 1 && steps < 10000) { // Prevent infinite loops
        if (current % 2 == 0) {
            current = current / 2;
        } else {
            current = current * 3 + 1;
        }
        steps++;
        maxValue = max(maxValue, current);
    }
    
    results[index].steps = steps;
    results[index].maxValue = maxValue;
}
"""

struct CollatzResult {
    let steps: UInt32
    let maxValue: UInt32
}

class GPUCollatzCalculator {
    private let device: MTLDevice
    private let commandQueue: MTLCommandQueue
    private let computePipelineState: MTLComputePipelineState
    
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
            let library = try device.makeLibrary(source: metalShaderSource, options: nil)
            let kernelFunction = library.makeFunction(name: "collatzCompute")
            self.computePipelineState = try device.makeComputePipelineState(function: kernelFunction!)
        } catch {
            print("Failed to create compute pipeline state: \(error)")
            return nil
        }
    }
    
    func calculateCollatzBatch(numbers: [UInt32]) -> [CollatzResult] {
        let inputBuffer = device.makeBuffer(bytes: numbers, length: numbers.count * MemoryLayout<UInt32>.size, options: [])!
        let outputBuffer = device.makeBuffer(length: numbers.count * MemoryLayout<CollatzResult>.size, options: [])!
        
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
        
        let resultPointer = outputBuffer.contents().bindMemory(to: CollatzResult.self, capacity: numbers.count)
        let results = Array(UnsafeBufferPointer(start: resultPointer, count: numbers.count))
        
        return results
    }
}

// Fallback CPU implementation
func collatzSequenceCPU(n: UInt32) -> (steps: UInt32, maxValue: UInt32) {
    var current = n
    var steps: UInt32 = 0
    var maxValue = n
    
    while current != 1 && steps < 10000 {
        if current % 2 == 0 {
            current = current / 2
        } else {
            current = current * 3 + 1
        }
        steps += 1
        maxValue = max(maxValue, current)
    }
    
    return (steps: steps, maxValue: maxValue)
}

// Main execution
print("Starting GPU-accelerated Collatz conjecture testing...")

if let gpuCalculator = GPUCollatzCalculator() {
    print("GPU acceleration enabled!")
    
    // Process numbers in batches for better GPU utilization
    let batchSize = 1024
    let totalNumbers = 10000
    
    let startTime = CFAbsoluteTimeGetCurrent()
    
    for batchStart in stride(from: 1, to: totalNumbers + 1, by: batchSize) {
        let batchEnd = min(batchStart + batchSize - 1, totalNumbers)
        let numbers = Array(batchStart...batchEnd).map { UInt32($0) }
        
        let results = gpuCalculator.calculateCollatzBatch(numbers: numbers)
        
        // Display results for first few numbers of each batch
        if batchStart <= 10 || batchStart % (batchSize * 10) == 1 {
            for (i, result) in results.prefix(min(5, results.count)).enumerated() {
                let number = numbers[i]
                print("GPU | Number: \(number) | Steps: \(result.steps) | Max: \(result.maxValue)")
            }
        }
        
        // Show progress
        if batchStart % (batchSize * 10) == 1 {
            let progress = Float(batchEnd) / Float(totalNumbers) * 100
            print("Progress: \(String(format: "%.1f", progress))% - Processed up to number \(batchEnd)")
        }
    }
    
    let endTime = CFAbsoluteTimeGetCurrent()
    let totalTime = endTime - startTime
    
    print("GPU computation completed!")
    print("Processed \(totalNumbers) numbers in \(String(format: "%.3f", totalTime)) seconds")
    print("Average: \(String(format: "%.0f", Double(totalNumbers) / totalTime)) numbers per second")
    
} else {
    print("GPU not available, falling back to CPU...")
    
    let startTime = CFAbsoluteTimeGetCurrent()
    
    // CPU fallback with threading
    let queue = DispatchQueue.global(qos: .userInteractive)
    let group = DispatchGroup()
    
    for i in 1...1000 {
        group.enter()
        queue.async {
            let result = collatzSequenceCPU(n: UInt32(i))
            if i <= 10 {
                print("CPU | Number: \(i) | Steps: \(result.steps) | Max: \(result.maxValue)")
            }
            group.leave()
        }
    }
    
    group.wait()
    
    let endTime = CFAbsoluteTimeGetCurrent()
    let totalTime = endTime - startTime
    
    print("CPU computation completed!")
    print("Processed 1000 numbers in \(String(format: "%.3f", totalTime)) seconds")
    print("Average: \(String(format: "%.0f", 1000.0 / totalTime)) numbers per second")
}
