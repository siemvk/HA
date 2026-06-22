// player/index.ts
var ws = new WebSocket("ws://localhost:8081");
function wsSend(ws2, data) {
  ws2.send(JSON.stringify(data));
}
ws.addEventListener("open", (ev) => {
  genReserved();
  document.getElementById("sendBtn").onclick = () => {
    const input = document.getElementById("pinInput");
    wsSend(ws, {
      type: "connect",
      pin: input.value
    });
  };
});
function init() {
  document.getElementById("code-card").hidden = true;
  document.getElementById("game-card").hidden = false;
}
ws.addEventListener("message", (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.type == "OK" && msg.ok) {
    init();
  } else if (msg.type == "UI-set") {
    document.getElementById("game-card").innerHTML = "";
    msg.elements.forEach((el) => {
      renderElement(el);
    });
  } else if (msg.type == "UI-update") {
    renderElement(msg.updated);
  }
});
var reservedIds = [];
function genReserved() {
  const alles = document.querySelectorAll("[id]");
  alles.forEach((el) => {
    reservedIds.push(el.id);
  });
}
function renderElement(el) {
  if (reservedIds.includes(el.id)) {
    console.log("triggering id overwrite");
    el.id += "_content";
  }
  switch (el.type) {
    case "txt":
      const betaand = document.getElementById(el.id);
      if (betaand) {
        betaand.innerText = el.content;
      } else {
        const newElement = document.createElement("h4");
        newElement.innerText = el.content;
        newElement.id = el.id;
        document.getElementById("game-card").appendChild(newElement);
      }
      break;
    case "html-render":
      const betaand3 = document.getElementById(el.id);
      if (betaand3) {
        betaand3.innerText = el.content;
      } else {
        const newElement = document.createElement("thing");
        newElement.innerHTML = el.content;
        newElement.id = el.id;
        document.getElementById("game-card").appendChild(newElement);
      }
      break;
    case "button":
      const betaand4 = document.getElementById(el.id);
      if (betaand4) {
        betaand4.innerText = el.content;
      } else {
        const newElement = document.createElement("button");
        newElement.classList.add("btn", "filled", "icon-right", "rounded", "waves-effect", "waves-light");
        newElement.innerHTML = el.content;
        if (el.value !== undefined) {
          const icon = document.createElement("i");
          icon.innerHTML = el.value;
          icon.classList.add("material-icons");
          newElement.appendChild(icon);
        }
        newElement.id = el.id;
        document.getElementById("game-card").appendChild(newElement);
      }
      break;
    default:
      const betaand2 = document.getElementById(el.id);
      if (betaand2) {
        betaand2.innerText = el.content;
      } else {
        const newElement = document.createElement("h4");
        newElement.innerText = "Render fout";
        newElement.id = el.id;
        document.getElementById("game-card").appendChild(newElement);
      }
      break;
  }
}
export {
  init
};

//# debugId=43656E90DF7AD00A64756E2164756E21
//# sourceMappingURL=index.js.map
