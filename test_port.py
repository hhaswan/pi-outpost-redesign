import socket

s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
try:
    s.bind(("0.0.0.0", 5555))
    s.listen(1)
    print("Listening on 5555")
    while True:
        conn, addr = s.accept()
        print(f"Connected by {addr}")
        conn.sendall(b"HTTP/1.1 200 OK\r\n\r\nHello")
        conn.close()
except Exception as e:
    print(e)
