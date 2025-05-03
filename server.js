require("dotenv").config();
const express = require("express");
const cors = require("cors");
const http = require("http");
const { Server } = require("socket.io");
const { AccessToken } = require("twilio").jwt;
const { VideoGrant } = AccessToken;

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.static("public"));
app.use(express.json());

// Manejo de señalización con Socket.IO
io.on("connection", (socket) => {
  console.log("Usuario conectado:", socket.id);

  // Unirse a una sala
  socket.on("join-room", (roomId, userId) => {
    socket.join(roomId);
    // Notificar a otros en la sala
    socket.to(roomId).emit("user-connected", userId);

    console.log(`Usuario ${userId} se unió a la sala ${roomId}`);

    // Cuando el usuario se desconecta
    socket.on("disconnect", () => {
      socket.to(roomId).emit("user-disconnected", userId);
      console.log(`Usuario ${userId} se desconectó de la sala ${roomId}`);
    });
  });

  // Reenviar la oferta SDP
  socket.on("offer", (roomId, offer) => {
    socket.to(roomId).emit("receive-offer", offer);
    console.log(`Oferta enviada en la sala ${roomId}`);
  });

  // Reenviar la respuesta SDP
  socket.on("answer", (roomId, answer) => {
    socket.to(roomId).emit("receive-answer", answer);
    console.log(`Respuesta enviada en la sala ${roomId}`);
  });

  // Reenviar candidatos ICE
  socket.on("ice-candidate", (roomId, candidate) => {
    socket.to(roomId).emit("receive-ice-candidate", candidate);
  });
});

// Ruta para obtener token de Twilio
app.get("/token", (req, res) => {
  try {
    const identity = req.query.identity || "usuario_" + Math.floor(Math.random() * 1000);
    
    // Verificar variables de entorno
    if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_API_KEY || !process.env.TWILIO_API_SECRET) {
      return res.status(500).json({ error: "Credenciales de Twilio no configuradas" });
    }
    
    // Crear token
    const token = new AccessToken(
      process.env.TWILIO_ACCOUNT_SID,
      process.env.TWILIO_API_KEY,
      process.env.TWILIO_API_SECRET,
      { identity }
    );
    
    // Agregar permisos de video
    const videoGrant = new VideoGrant();
    token.addGrant(videoGrant);
    
    res.json({
      identity,
      token: token.toJwt()
    });
    
  } catch (err) {
    console.error("Error generando token:", err);
    res.status(500).json({ error: "Error generando token: " + err.message });
  }
});

server.listen(port, () => {
  console.log(`Servidor ejecutándose en http://localhost:${port}`);
});