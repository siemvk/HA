const ws = new WebSocket("ws://localhost:8085");

ws.onmessage = (e) => {
  console.log(e.data);
};

for await (const line of console) {
  if (!line.trim()) continue;
  ws.send(line);
}
