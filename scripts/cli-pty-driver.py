import os,pty,subprocess,sys,select,json,fcntl,termios,struct,signal
master,slave=pty.openpty()
fcntl.ioctl(slave,termios.TIOCSWINSZ,struct.pack('HHHH',40,120,0,0))
p=subprocess.Popen(sys.argv[1:],stdin=slave,stdout=slave,stderr=slave,start_new_session=True,env=os.environ.copy())
os.close(slave)
try:
 while p.poll() is None:
  ready,_,_=select.select([master,sys.stdin],[],[],.2)
  if master in ready:
   try: data=os.read(master,65536)
   except OSError: break
   if data: print(json.dumps({'terminal':data.decode('utf8','replace')}),flush=True)
  if sys.stdin in ready:
   line=sys.stdin.readline()
   if not line: break
   cmd=json.loads(line)
   if cmd.get('stop'): break
   os.write(master,cmd['text'].encode())
finally:
 try: os.killpg(p.pid,signal.SIGTERM)
 except ProcessLookupError: pass
 try:p.wait(timeout=3)
 except subprocess.TimeoutExpired:os.killpg(p.pid,signal.SIGKILL)
 os.close(master)
