const socket = io();

var inputString = null;
while (inputString === null || inputString.trim().length <= 0) {
  inputString = prompt("닉네임을 입력하세요 (아이디 대용 - 필수 입력)");
}

socket.emit("nick", inputString);

socket.emit("get_room");

const welcome = document.getElementById("welcome");
const form = welcome.querySelector("form");

function handleMsgSubmit(event) {
  event.preventDefault();
  const input = document.getElementById("msg").querySelector("input");
  const value = input.value;
  socket.emit("new_msg", input.value, roomObject.sid, roomObject.id, () => {
    addMsg(`${value}`, "my");
  });
  input.value = "";
}

let roomObject = null;
let roomName = null;

async function addMsg(msg, type) {
  const ul = document.getElementById("content").querySelector("ul");
  const li = document.createElement("li");
  li.innerText = msg;
  switch (type) {
    case "leave":
      li.classList.add("red");
      break;
    case "welcome":
      li.classList.add("blue");
      break;
    case "my":
      li.style.textAlign = "right";
      break;
  }

  ul.appendChild(li);

  ul.scrollTop = ul.scrollHeight;
}

function handleRoomSubmit(event) {
  event.preventDefault();
  const input = form.querySelector("input");
  socket.emit("room", input.value, async (room) =>
    openRoom(room.id, room.sid, room.title)
  );
  roomName = input.value;
  input.value = "";
}

form.addEventListener("submit", handleRoomSubmit);

socket.on("set_user", (object) => {
  socket["nick"] = object.nick;
  socket["userid"] = object.userid;
});

socket.on("welcomeMSG", (nick) => {
  addMsg(`${nick} 님이 입장하였습니다.`, "welcome");
});

socket.on("bye", (nick) => {
  addMsg(`${nick} 님이 방을 떠났습니다.`, "leave");
});

socket.on("new_msg", async (msg) => {
  addMsg(msg, "chat");
});

socket.on("room_change", async (rooms) => {
  const roomList = welcome.querySelector("ul");
  roomList.innerHTML = "";

  if (rooms.length === 0) {
    return;
  }

  rooms.forEach((room) => {
    const li = document.createElement("li");
    li.innerHTML = `${room.title} ( ${room.count} 명 )<br/> ${room.msg}`;
    li.classList.add("room-item");
    li.id = room.id;
    li.setAttribute(
      "onclick",
      `openRoom(${room.id},'${room.sid}','${room.title}')`
    );

    roomList.append(li);
  });
});

async function openRoom(roomId, roomSid, roomTitle) {
  try {
    roomObject = {
      id: roomId,
      sid: roomSid,
      title: roomTitle,
    };

    await socket.emit("open_room", roomSid, openChat);
  } catch (error) {
    console.error("Error fetching room data:", error);
  }
}

async function openChat(room) {
  const response = await fetch(`/api/room/${room.id}`, { method: "GET" });
  if (!response.ok) {
    throw new Error("Failed to fetch room data");
  }

  const chats = await response.json();

  const ul = document.createElement("ul");

  if (chats) {
    chats.forEach((chat) => {
      const li = document.createElement("li");

      if (chat.type === "chat") {
        if (socket["userid"] === chat.userid) {
          li.innerText = `${chat.msg}`;
          li.style.textAlign = "right";
        } else {
          li.innerText = `${chat.nick} : ${chat.msg}`;
        }
      } else if (chat.type === "welcome") {
        li.innerText = `${chat.nick} 님이 입장하였습니다.`;
        li.classList.add("blue");
      } else if (chat.type === "leave") {
        li.innerText = `${chat.nick} 님이 떠났습니다.`;
        li.classList.add("red");
      }
      ul.append(li);
    });
  }

  setConect(room.title, ul);

  ul.scrollTop = ul.scrollHeight;
}

async function setConect(title, ul) {
  const contentDisplay = document.getElementById("content");
  ul.classList.add("message-list");
  contentDisplay.innerHTML = "";
  const h3 = document.createElement("h3");
  h3.innerText = title;
  contentDisplay.appendChild(h3);
  contentDisplay.appendChild(ul);

  // 폼 추가
  const form = document.createElement("form");
  form.id = "msg";

  const input = document.createElement("input");
  input.type = "text";
  input.placeholder = "Enter your message...";
  input.required = true;

  const button = document.createElement("button");
  button.type = "submit";
  button.innerText = "Send";
  form.addEventListener("submit", handleMsgSubmit);

  form.appendChild(input);
  form.appendChild(button);

  contentDisplay.appendChild(form);
}
