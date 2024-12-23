"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { io, Socket } from "socket.io-client";
import { useRouter } from "next/navigation"; // Add this import

interface Player {
  id: string;
  nickname: string;
  hasSubmitted?: boolean; // Add this property
}

export interface Verse {
  lyrics: string;
  image: string;
  author: string;
}

export interface Song {
  title: string;
  cover: string;
  verses: Verse[];
  genre: string;
  shortGenre: string;
  url: string;
}

interface GameState {
  players: Player[];
  isAdmin: boolean;
  playerId: string | null;
  nickname: string;
  hasSubmittedDrawing: boolean;
  waitingForOthersToSubmit: boolean;
  isSubmittingDrawing: boolean;
  submitError: string | null;
  song: Song | null;
  allPlayersSubmitted: boolean;
  hasJoined: boolean;
  joinError: string | null; // Add this line
  drawings: Array<{
    playerId: string;
    nickname: string;
    imageData: string;
    submitted: boolean;
  }>;
}

interface GameStateContextType {
  socket: Socket | null;
  gameState: GameState;
  setGameState: React.Dispatch<React.SetStateAction<GameState>>;
  updateGameState: (updates: Partial<GameState>) => void;
  joinGame: (nickname: string) => void;
}

const SocketContext = createContext<GameStateContextType | null>(null);

const initialGameState: GameState = {
  players: [],
  playerId: null,
  nickname: "",
  isAdmin: false,

  isSubmittingDrawing: false,
  hasSubmittedDrawing: false,
  waitingForOthersToSubmit: false,
  allPlayersSubmitted: false,
  submitError: null,

  song: null,
  hasJoined: false,
  joinError: null, // Add this line
  drawings: [],
};

export const useGameState = () => {
  const context = useContext(SocketContext);
  if (!context)
    throw new Error("useGameState must be used within SocketProvider");
  return context;
};

export function SocketProvider({ children }: { children: React.ReactNode }) {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [gameState, setGameState] = useState<GameState>(initialGameState);
  const router = useRouter(); // Add this

  const updateGameState = (updates: Partial<GameState>) => {
    setGameState((prev) => ({ ...prev, ...updates }));
  };

  const joinGame = (nickname: string) => {
    const playerId = Math.random().toString(36).substring(2, 7);
    console.log("joining game with nickname", nickname);
    updateGameState({
      playerId,
      nickname,
    }); // removed hasJoined: true from here

    const newSocket = io(
      process.env.NEXT_PUBLIC_SOCKET_SERVER_URL,
      {
        transports: ['websocket', 'polling'],
        reconnection: true,
        reconnectionAttempts: 5,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 5000,
        timeout: 20000,
        autoConnect: true,
      }
    );

    newSocket.on("connect_error", (error) => {
      console.error("Connection error:", error);
      updateGameState({
        joinError: "Failed to connect to server. Retrying...",
        hasJoined: false,
      });
    });

    newSocket.on("reconnect", (attemptNumber) => {
      console.log("Reconnected on attempt", attemptNumber);
      if (gameState.nickname && gameState.playerId) {
        newSocket.emit("joinLobby", {
          playerId: gameState.playerId,
          nickname: gameState.nickname,
        });
      }
    });

    newSocket.on("reconnect_error", (error) => {
      console.error("Reconnection error:", error);
      updateGameState({
        joinError: "Failed to reconnect to server",
        hasJoined: false,
      });
    });

    setSocket(newSocket);

    newSocket.on("connect", () => {
      newSocket.emit("joinLobby", {
        playerId,
        nickname,
      });
      updateGameState({
        hasJoined: true,
      });
    });

    newSocket.on("kicked", () => {
      console.log("kicked from game");
      setGameState(initialGameState);
      newSocket.disconnect();
      setSocket(null);
      updateGameState({ joinError: "You were kicked" });
      router.push("/"); // Add this line
    });

    newSocket.on("adminJoined", () => {
      console.log("admin joined");
      updateGameState({
        isAdmin: true,
      });
    });

    newSocket.on("joinRejected", (reason: string) => {
      console.log("rejected");
      updateGameState({
        joinError: reason,
        hasJoined: false,
      });
      newSocket.disconnect();
      setSocket(null);
    });

    newSocket.on("lobbyUpdate", (updatedPlayers: Player[]) => {
      console.log("my id:", playerId);
      console.log("lobby update", updatedPlayers);
      updateGameState({
        players: updatedPlayers,
      });
    });

    newSocket.on("displaySong", (songData: Song) => {
      updateGameState({
        song: songData,
      });
    });

    // Add a listener for the "error" event
    newSocket.on("error", (errorMessage: string) => {
      console.log("Server error:", errorMessage);
      updateGameState({
        submitError: errorMessage,
        isSubmittingDrawing: false,
      });
    });

    newSocket.on("allDrawingsSubmitted", () => {
      console.log("all submitted");
      updateGameState({
        waitingForOthersToSubmit: false,
        allPlayersSubmitted: true,
      });
    });

    newSocket.on(
      "drawingSubmitted",
      (drawing: { playerId: string; nickname: string; imageData: string }) => {
        setGameState((prev: GameState) => {
          const existingIndex = prev.drawings.findIndex(
            (d) => d.playerId === drawing.playerId
          );
          if (existingIndex !== -1) {
            const updatedDrawings = [...prev.drawings];
            updatedDrawings[existingIndex] = { ...drawing, submitted: true };
            return { ...prev, drawings: updatedDrawings };
          }
          return {
            ...prev,
            drawings: [...prev.drawings, { ...drawing, submitted: true }],
          };
        });
      }
    );

    newSocket.on(
      "drawingUpdate",
      (drawing: { playerId: string; nickname: string; imageData: string }) => {
        setGameState((prev: GameState) => {
          const existingIndex = prev.drawings.findIndex(
            (d) => d.playerId === drawing.playerId
          );
          if (existingIndex !== -1) {
            const updatedDrawings = [...prev.drawings];
            updatedDrawings[existingIndex] = {
              ...drawing,
              submitted: prev.drawings[existingIndex].submitted,
            };
            return { ...prev, drawings: updatedDrawings };
          }
          return {
            ...prev,
            drawings: [...prev.drawings, { ...drawing, submitted: false }],
          };
        });
      }
    );
  };

  useEffect(() => {
    return () => {
      if (socket) socket.close();
    };
  }, [socket]);

  return (
    <SocketContext.Provider
      value={{
        socket,
        gameState,
        setGameState,
        updateGameState,
        joinGame,
      }}
    >
      {children}
    </SocketContext.Provider>
  );
}
