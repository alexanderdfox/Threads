import Foundation
import Dispatch

var i = 1
var mostStepsRecord = (number: 0, steps: 0)
let recordLock = NSLock()

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
    
    // Check if this is a new record for most steps
    recordLock.lock()
    if steps > mostStepsRecord.steps {
        mostStepsRecord = (number: number, steps: steps)
        print("Most Steps: \(number) (\(steps) steps)")
    }
    recordLock.unlock()
    
    // Create child threads that explore related Collatz numbers
    let childThread = Thread {
        // Calculate next interesting number based on current result
        var nextNumber: Int
        if steps > 20 {
            // If this number took many steps, try a nearby number
            nextNumber = number + Int.random(in: 1...10)
        } else if maxValue > number * 10 {
            // If this number reached a high peak, try doubling it
            nextNumber = number * 2
        } else {
            // Default: just try the next sequential number
            nextNumber = number + 1
        }
        
        collatzThread(number: nextNumber, threadName: threadName + "*", depth: depth + 1)
    }
    childThread.start()
}

// Start initial threads for infinite Collatz exploration
print("🚀 Starting infinite Collatz conjecture exploration...")
print("Only printing new records for most steps to reach 1")
print("Press Ctrl+C to stop")

while true {
    let thread = Thread {
        collatzThread(number: i, threadName: "Collatz-\(i)")
    }
    thread.start()
    i += 1
}
