import Foundation
import Dispatch

var i = 1

func collatzSequence(n: Int) -> [Int] {
    var sequence = [n]
    var current = n
    
    while current != 1 {
        if current % 2 == 0 {
            current = current / 2
        } else {
            current = current * 3 + 1
        }
        sequence.append(current)
    }
    
    return sequence
}

func collatzThread(number: Int, threadName: String, depth: Int = 0) {
    let sequence = collatzSequence(n: number)
    let steps = sequence.count - 1
    let maxValue = sequence.max() ?? number
    
    print("Thread \(threadName) | Number: \(number) | Steps: \(steps) | Max: \(maxValue) | Depth: \(depth)")
    print("  Sequence: \(sequence.prefix(10).map(String.init).joined(separator: " -> "))\(sequence.count > 10 ? "..." : "")")
    
    // Create child threads for related numbers if depth is reasonable
    if depth < 3 && number < 1000 {
        // Spawn thread for next number
        let nextThread = Thread {
            collatzThread(number: number + 1, threadName: threadName + "*", depth: depth + 1)
        }
        nextThread.start()
        
        // Spawn thread for a related interesting number
        if number % 2 == 0 {
            let relatedThread = Thread {
                collatzThread(number: number * 3 + 1, threadName: threadName + "**", depth: depth + 1)
            }
            relatedThread.start()
        }
    }
}

// Start initial threads for Collatz conjecture testing
while true {
    let thread = Thread {
        collatzThread(number: i, threadName: "Collatz-\(i)")
    }
    thread.start()
    i += 1
    
    // Add a small delay to prevent overwhelming the system
    Thread.sleep(forTimeInterval: 0.1)
    
    // Stop after testing reasonable range
    if i > 100 {
        print("Completed Collatz testing for numbers 1-100")
        break
    }
}
