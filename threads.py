import threading
import time

i = 0

def moving_thread(name, depth=0):
	print(f"Thread {name} at depth {depth}")
	t = threading.Thread(target=moving_thread, args=(name+"*", depth+1))
	t.start()

# Start initial threads
while True:
	t = threading.Thread(target=moving_thread, args=(f"Thread-{i}",))
	t.start()
	i += 1