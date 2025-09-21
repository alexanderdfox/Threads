import Foundation
import Dispatch
import BigInt

// Big Integer Collatz Explorer - No limits!
struct BigIntCollatzResult {
    let steps: UInt64
    let maxValue: BigUInt
    let originalNumber: BigUInt
    let reachedLimit: Bool
}

class BigIntCollatzExplorer {
    private var mostStepsRecord: (number: BigUInt, steps: UInt64) = (0, 0)
    private let recordLock = NSLock()
    private var totalProcessed: UInt64 = 0
    private let startTime = CFAbsoluteTimeGetCurrent()
    private let maxSteps: UInt64 = 100000
    private let overflowLimit: BigUInt = BigUInt(10).power(100) // 10^100 limit
    
    func calculateCollatz(_ n: BigUInt) -> BigIntCollatzResult {
        var current = n
        var steps: UInt64 = 0
        var maxValue = n
        var reachedLimit = false
        
        while current != 1 && steps < maxSteps {
            if current % 2 == 0 {
                current = current / 2
            } else {
                current = current * 3 + 1
                
                // Check if we've exceeded our practical limit
                if current > overflowLimit {
                    reachedLimit = true
                    break
                }
            }
            
            steps += 1
            maxValue = max(maxValue, current)
        }
        
        return BigIntCollatzResult(
            steps: steps,
            maxValue: maxValue,
            originalNumber: n,
            reachedLimit: reachedLimit
        )
    }
    
    func processNumbersCPU(_ numbers: [BigUInt]) -> [BigIntCollatzResult] {
        let startTime = CFAbsoluteTimeGetCurrent()
        
        let results = numbers.map { number in
            calculateCollatz(number)
        }
        
        let processingTime = CFAbsoluteTimeGetCurrent() - startTime
        let rate = Double(numbers.count) / processingTime
        
        print("🔢 BigInt processed \(numbers.count) numbers in \(String(format: "%.3f", processingTime))s (\(String(format: "%.0f", rate))/sec)")
        
        return results
    }
    
    func processNumbersParallel(_ numbers: [BigUInt]) -> [BigIntCollatzResult] {
        let startTime = CFAbsoluteTimeGetCurrent()
        let chunkSize = max(numbers.count / ProcessInfo.processInfo.activeProcessorCount, 10)
        let chunks = numbers.chunked(into: chunkSize)
        
        var allResults: [BigIntCollatzResult] = []
        let resultsLock = NSLock()
        let group = DispatchGroup()
        let queue = DispatchQueue(label: "bigint.collatz", attributes: .concurrent)
        
        for chunk in chunks {
            group.enter()
            queue.async {
                let chunkResults = chunk.map { self.calculateCollatz($0) }
                
                resultsLock.lock()
                allResults.append(contentsOf: chunkResults)
                resultsLock.unlock()
                
                group.leave()
            }
        }
        
        group.wait()
        
        let processingTime = CFAbsoluteTimeGetCurrent() - startTime
        let rate = Double(numbers.count) / processingTime
        
        print("🧵 BigInt parallel processed \(numbers.count) numbers in \(String(format: "%.3f", processingTime))s (\(String(format: "%.0f", rate))/sec)")
        
        return allResults.sorted { $0.originalNumber < $1.originalNumber }
    }
    
    private func updateRecords(_ results: [BigIntCollatzResult]) {
        recordLock.lock()
        defer { recordLock.unlock() }
        
        for result in results {
            if result.steps > mostStepsRecord.steps {
                mostStepsRecord = (number: result.originalNumber, steps: result.steps)
                let elapsed = CFAbsoluteTimeGetCurrent() - startTime
                let rate = Double(totalProcessed) / elapsed
                
                print("🏆 NEW BIGINT RECORD! Number: \(result.originalNumber) took \(result.steps) steps")
                print("   Max value reached: \(result.maxValue)")
                if result.reachedLimit {
                    print("   ⚠️  Reached overflow limit (10^100)")
                }
                print("   Processed \(totalProcessed) numbers in \(String(format: "%.1f", elapsed))s (avg \(String(format: "%.0f", rate))/sec)")
            }
        }
    }
    
    func startExploration() {
        print("🚀 Starting BigInt Collatz Exploration (No UInt64 limits!)")
        print("📊 Can handle numbers up to 10^100")
        print("🎯 Searching for extreme Collatz sequences")
        print("Press Ctrl+C to stop\n")
        
        var currentStart = BigUInt(1)
        let batchSize = 100 // Smaller batches due to BigInt overhead
        
        while true {
            // Generate batch of numbers
            let numbers = (0..<batchSize).map { BigUInt(currentStart + BigUInt($0)) }
            
            // Process with parallel BigInt
            let results = processNumbersParallel(numbers)
            
            // Update counters and records
            totalProcessed += UInt64(results.count)
            updateRecords(results)
            
            // Print progress
            if totalProcessed % 1000 == 0 {
                let elapsed = CFAbsoluteTimeGetCurrent() - startTime
                let rate = Double(totalProcessed) / elapsed
                print("📊 Progress: \(totalProcessed) numbers processed")
                print("   Rate: \(String(format: "%.0f", rate)) numbers/sec")
                print("   Current record: \(mostStepsRecord.number) (\(mostStepsRecord.steps) steps)")
                print("   Currently at: \(currentStart)")
            }
            
            currentStart += BigUInt(batchSize)
            
            // Test some large numbers occasionally
            if totalProcessed % 5000 == 0 {
                testLargeNumbers()
            }
        }
    }
    
    private func testLargeNumbers() {
        print("\n🔬 Testing some large numbers beyond UInt64...")
        
        let largeNumbers: [BigUInt] = [
            BigUInt("18446744073709551616"),  // UInt64.max + 1
            BigUInt("100000000000000000000"), // 10^20
            BigUInt("123456789012345678901234567890"), // 30 digits
        ]
        
        for number in largeNumbers {
            let result = calculateCollatz(number)
            print("   \(number): \(result.steps) steps (max: \(result.maxValue))")
            if result.reachedLimit {
                print("     ⚠️  Hit overflow limit")
            }
        }
        print()
    }
}

// Extension for array chunking (same as before)
extension Array {
    func chunked(into size: Int) -> [[Element]] {
        return stride(from: 0, to: count, by: size).map {
            Array(self[$0..<Swift.min($0 + size, count)])
        }
    }
}

// Main execution
let bigIntExplorer = BigIntCollatzExplorer()
bigIntExplorer.startExploration()
