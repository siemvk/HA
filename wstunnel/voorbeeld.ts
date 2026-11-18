const ws = new WebSocket("wss://tunnel.siemvk.nl/testing");

ws.onmessage = (e) => {
  console.log(e.data);
};

for await (const line of console) {
  if (!line.trim()) continue;
  ws.send(line);
}
