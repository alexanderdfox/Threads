import Foundation
import Dispatch

var i = 0

func movingThread(name: String, depth: Int = 0) {
    print("Thread \(name) at depth \(depth)")
    
    // Create a new thread that calls movingThread recursively
    let thread = Thread {
        movingThread(name: name + "*", depth: depth + 1)
    }
    thread.start()
}

// Start initial threads in an infinite loop
while true {
    let thread = Thread {
        movingThread(name: "Thread-\(i)")
    }
    thread.start()
    i += 1
}
