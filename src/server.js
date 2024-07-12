import express from "express";
import path from "path";
import http from "http";
import SocketIO from "socket.io";
import pool from "../chatdb.js";
import { v4 as uuidv4 } from "uuid"; // ES Modules
const __dirname = path.resolve();

const app = express();

app.set("view engine", "pug");
app.set("views", path.join(__dirname + "/src/views"));
app.use("/public", express.static(path.join(__dirname, "/src/public")));

app.get("/", (req, res) => res.render("home"));

app.get("/api/room/:room_id", async (req, res) => {
  const room_id = req.params.room_id;

  try {
    const result = await pool.query(
      `SELECT 
        u.id as userid,
        u.nick as nick,
        c.msg as msg,
        c.type as type
      FROM "CHAT" c 
      INNER JOIN "USERS" u 
      ON c.user_id = u.id
      WHERE room_id = $1 ORDER BY c.id ASC
      `,
      [room_id]
    );
    if (result.rows.length > 0) {
      res.json(result.rows);
    } else {
      res.json([]);
    }
  } catch (error) {
    console.error("Error executing query", error.stack);
    res.status(500).json({ error: "Internal Server Error" });
  }
});
app.get("/*", (req, res) => res.redirect("/"));

const handleListen = () => console.log("Listening on http://localhost:3033");

const server = http.createServer(app);
const wss = SocketIO(server);

async function getRecentLeaveCount(roomId) {
  const query = `
      WITH recent_leave_data AS (
          SELECT
              user_id,
              COUNT(*) AS cnt
          FROM "CHAT"
          WHERE type = 'leave'
            AND room_id = $1
            AND created_at >= NOW() - INTERVAL '30 minutes'
          GROUP BY user_id
      )
      SELECT COALESCE(SUM(cnt), 0) AS total_leave_count
      FROM recent_leave_data;
  `;

  try {
    const result = await pool.query(query, [roomId]);
    return result.rows[0]?.total_leave_count || 0;
  } catch (error) {
    console.error("Error executing query:", error);
    throw error;
  }
}

async function publicRooms() {
  const pRooms = await pool.query(
    `
    SELECT 
          r.id,
          r.title,
          r.sid,
          COALESCE(c.msg, '') AS msg,
          COALESCE(out_users_in_30_min.cnt, 0) AS out_users_in_30_min_count
      FROM 
          "ROOM" r
      LEFT JOIN (
          SELECT 
              room_id,
              msg,
              created_at
          FROM 
              (
                  SELECT 
                      room_id,
                      msg,
                      created_at,
                      ROW_NUMBER() OVER (PARTITION BY room_id ORDER BY created_at DESC) AS rn
                  FROM 
                      "CHAT"
                  WHERE 
                      type = 'chat'
              ) sub
          WHERE 
              rn = 1
      ) c ON r.id = c.room_id
      LEFT JOIN (
          SELECT 
              room_id,
              COUNT(*) AS cnt
          FROM 
              (
                  SELECT 
                      room_id,
                      type,
                      created_at,
                      ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY created_at DESC) AS rn
                  FROM 
                      "CHAT"
                  WHERE 
                      type <> 'chat'
              ) sub
          WHERE 
              rn = 1
          AND type= 'leave'
          AND created_at >= NOW() - INTERVAL '30 minutes'
          GROUP BY 
              room_id
      ) out_users_in_30_min ON r.id = out_users_in_30_min.room_id
    `
  );

  const rooms = pRooms?.rows;

  for (const room of rooms) {
    const realTimeUser = wss.sockets.adapter.rooms.get(room.sid)?.size || 0;
    room["count"] = realTimeUser + Number(room.out_users_in_30_min_count);
  }

  rooms.sort((a, b) => b.count - a.count);

  return rooms;
}

wss.on("connection", (socket) => {
  socket.onAny((event) => {
    console.log(`Event Name : ${event}`);
  });
  socket.on("open_room", async (sid, openChat) => {
    try {
      //만약 내가 방을 최종적으로 나갔거나, 처음 들어온거면 다시 입력
      const room = await pool.query('SELECT * FROM "ROOM" WHERE sid = $1', [
        sid,
      ]);

      const leave = await pool.query(
        `
        SELECT *
        FROM "CHAT"
        WHERE room_id = $1
        AND user_id = $2
        AND type <> 'chat'
        ORDER BY ID DESC
        LIMIT 1
      `,
        [room.rows[0].id, socket["userid"]]
      );

      if (leave.rowCount === 0 || leave.rows[0].type === "leave") {
        await pool.query(
          'INSERT INTO "CHAT" (user_id, room_id,msg, type) VALUES ($1, $2,$3, $4) RETURNING *',
          [socket["userid"], room.rows[0].id, null, "welcome"]
        );
        await socket.to(sid).emit("welcomeMSG", socket.nick);
      }
      socket.join(sid);
      await openChat(room.rows[0]);
      wss.sockets.emit("room_change", await publicRooms());
    } catch (err) {
      console.error("Database query error : ", err.stack);
    }
  });
  socket.on("room", async (title, showRoom) => {
    const sid = uuidv4();
    socket.join(sid);

    var room = null;

    try {
      room = await pool.query(
        'INSERT INTO "ROOM" (title, sid) VALUES ($1, $2) RETURNING *',
        [title, sid]
      );
      await pool.query(
        'INSERT INTO "CHAT" (user_id, room_id,msg, type) VALUES ($1, $2,$3, $4) RETURNING *',
        [socket["userid"], room.rows[0].id, null, "welcome"]
      );
    } catch (err) {
      console.error("Database query error : ", err.stack);
    }

    await showRoom(room.rows[0]);
    socket.to(sid).emit("welcomeMSG", socket.nick);

    wss.sockets.emit("room_change", await publicRooms());
  });

  socket.on("get_room", async () => {
    wss.sockets.emit("room_change", await publicRooms());
  });

  socket.on("disconnecting", async () => {
    const myRooms = wss.sockets.adapter.sids.get(socket.id);
    myRooms.forEach(async (room) => {
      socket.to(room).emit("bye", socket.nick);
      const r = await pool.query('SELECT * FROM "ROOM" WHERE sid = $1', [room]);
      if (r.rows?.[0]) {
        await pool.query(
          'INSERT INTO "CHAT" (user_id, room_id,msg, type) VALUES ($1, $2,$3, $4)',
          [socket["userid"], r.rows[0].id, null, "leave"]
        );
      }
    });
  });

  socket.on("disconnect", async () => {
    wss.sockets.emit("room_change", await publicRooms());
  });
  socket.on("new_msg", async (msg, sid, roomId, done) => {
    socket.to(sid).emit("new_msg", `${socket.nick}: ${msg}`);

    try {
      await pool.query(
        'INSERT INTO "CHAT" (user_id, room_id, msg, type) VALUES ($1, $2,$3, $4) RETURNING *',
        [socket["userid"], roomId, msg, "chat"]
      );
    } catch (err) {
      console.error("Database query error : ", err.stack);
    }
    wss.sockets.emit("room_change", await publicRooms());
    try {
      await done();
    } catch (error) {
      console.error("Error in await done():", error);
    }
  });

  socket.on("nick", async (nick) => {
    socket["nick"] = nick;

    try {
      const res = await pool.query('SELECT * FROM "USERS" WHERE nick = $1', [
        nick,
      ]);

      if (res.rows.length > 0) {
        socket["userid"] = res.rows[0].id;
      } else {
        const insertRes = await pool.query(
          'INSERT INTO "USERS" (nick) VALUES ($1) RETURNING *',
          [nick]
        );
        socket["userid"] = insertRes.rows[0].id;
      }
      socket.emit("set_user", {
        userid: socket["userid"],
        nick,
      });
    } catch (err) {
      console.error("Database query error : ", err.stack);
    }
  });
});

server.listen(3033, handleListen);
