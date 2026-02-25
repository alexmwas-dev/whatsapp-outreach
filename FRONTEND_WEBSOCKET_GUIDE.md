# Frontend WebSocket Integration Guide

## Backend Setup Complete ✅

The backend now supports real-time WebSocket connections using Socket.io. No more polling!

## Frontend Implementation

### 1. Install Socket.io Client

```bash
cd SALEREP-FRONTEND
npm install socket.io-client
```

### 2. Create Socket Service

Create `src/services/socket.js`:

```javascript
import { io } from "socket.io-client";

class SocketService {
  constructor() {
    this.socket = null;
  }

  connect(token) {
    if (this.socket?.connected) return;

    this.socket = io(import.meta.env.VITE_API_URL || "http://localhost:3000", {
      auth: { token },
      autoConnect: true,
    });

    this.socket.on("connect", () => {
      console.log("✅ Connected to WebSocket server");
    });

    this.socket.on("disconnect", () => {
      console.log("❌ Disconnected from WebSocket server");
    });

    this.socket.on("connect_error", (error) => {
      console.error("WebSocket connection error:", error.message);
    });
  }

  disconnect() {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
  }

  // Join a contact conversation room
  joinContact(contactId) {
    if (this.socket?.connected) {
      this.socket.emit("join:contact", contactId);
    }
  }

  // Leave a contact conversation room
  leaveContact(contactId) {
    if (this.socket?.connected) {
      this.socket.emit("leave:contact", contactId);
    }
  }

  // Listen for new messages
  onNewMessage(callback) {
    if (this.socket) {
      this.socket.on("message:new", callback);
    }
  }

  // Listen for messages marked as read
  onMessagesRead(callback) {
    if (this.socket) {
      this.socket.on("messages:read", callback);
    }
  }

  // Listen for contact updates
  onContactUpdate(callback) {
    if (this.socket) {
      this.socket.on("contact:updated", callback);
    }
  }

  // Remove listeners
  off(event) {
    if (this.socket) {
      this.socket.off(event);
    }
  }
}

export default new SocketService();
```

### 3. Connect on Login

In your authentication/login component:

```javascript
import socketService from "./services/socket";

// After successful login
const handleLogin = async (credentials) => {
  const response = await api.post("/auth/login", credentials);
  const { token } = response.data;

  // Save token
  localStorage.setItem("token", token);

  // Connect to WebSocket
  socketService.connect(token);
};
```

### 4. Update Message List Component

Replace polling with WebSocket listeners:

```javascript
import { useEffect, useState } from "react";
import socketService from "../services/socket";

function ContactMessages({ contactId }) {
  const [messages, setMessages] = useState([]);

  useEffect(() => {
    // Load initial messages
    loadMessages();

    // Join this contact's room
    socketService.joinContact(contactId);

    // Listen for new messages
    const handleNewMessage = (message) => {
      if (message.contactId === contactId) {
        setMessages((prev) => [...prev, message]);
      }
    };

    socketService.onNewMessage(handleNewMessage);

    // Cleanup
    return () => {
      socketService.leaveContact(contactId);
      socketService.off("message:new");
    };
  }, [contactId]);

  const loadMessages = async () => {
    const response = await api.get(`/messages/contacts/${contactId}/messages`);
    setMessages(response.data.data.messages);
  };

  // ... rest of component
}
```

### 5. Update Contact List Component

Listen for unread message updates:

```javascript
import { useEffect, useState } from "react";
import socketService from "../services/socket";

function ContactList() {
  const [contacts, setContacts] = useState([]);

  useEffect(() => {
    // Load initial contacts once
    loadContacts();

    // Listen for new messages to update unread counts
    const handleNewMessage = (message) => {
      if (message.direction === "INBOUND") {
        setContacts((prev) =>
          prev.map((contact) =>
            contact.id === message.contactId
              ? { ...contact, unreadCount: (contact.unreadCount || 0) + 1 }
              : contact,
          ),
        );
      }
    };

    // Listen for messages marked as read
    const handleMessagesRead = ({ contactId }) => {
      setContacts((prev) =>
        prev.map((contact) =>
          contact.id === contactId ? { ...contact, unreadCount: 0 } : contact,
        ),
      );
    };

    // Listen for contact status updates
    const handleContactUpdate = (updatedContact) => {
      setContacts((prev) =>
        prev.map((contact) =>
          contact.id === updatedContact.id
            ? { ...contact, ...updatedContact }
            : contact,
        ),
      );
    };

    socketService.onNewMessage(handleNewMessage);
    socketService.onMessagesRead(handleMessagesRead);
    socketService.onContactUpdate(handleContactUpdate);

    // Cleanup
    return () => {
      socketService.off("message:new");
      socketService.off("messages:read");
      socketService.off("contact:updated");
    };
  }, []);

  const loadContacts = async () => {
    const response = await api.get("/messages/contacts?status=ASSIGNED");
    setContacts(response.data.data.contacts);
  };

  // ... rest of component
}
```

### 6. Disconnect on Logout

```javascript
const handleLogout = () => {
  socketService.disconnect();
  localStorage.removeItem("token");
  // Redirect to login
};
```

## Events Reference

### Events Emitted by Backend

| Event             | Data                                                           | Description                  |
| ----------------- | -------------------------------------------------------------- | ---------------------------- |
| `message:new`     | `{ id, contactId, salesRepId, direction, message, createdAt }` | New message received or sent |
| `messages:read`   | `{ contactId, count, readAt }`                                 | Messages marked as read      |
| `contact:updated` | `{ id, status, consent, salesRepId, updatedAt }`               | Contact status changed       |

### Events Emitted by Client

| Event           | Data        | Description                       |
| --------------- | ----------- | --------------------------------- |
| `join:contact`  | `contactId` | Join a contact conversation room  |
| `leave:contact` | `contactId` | Leave a contact conversation room |

## Benefits

✅ **Real-time updates** - Messages appear instantly  
✅ **Reduced server load** - No more polling every 10 seconds  
✅ **Lower bandwidth** - Only send data when changes occur  
✅ **Better UX** - Instant notifications and updates  
✅ **Scalable** - Handles many concurrent users efficiently

## Testing

1. Start your backend server
2. Open two browser tabs with different sales reps
3. Send a message from one tab
4. See it appear instantly in the other tab
5. Check console for WebSocket connection logs

## Environment Variables

Add to your frontend `.env`:

```env
VITE_API_URL=http://localhost:3000
```

## Troubleshooting

**Connection fails:**

- Check JWT token is valid
- Verify FRONTEND_URL in backend .env matches your frontend URL
- Check CORS settings

**Messages not appearing:**

- Ensure you call `joinContact(contactId)` before viewing conversation
- Check browser console for WebSocket errors
- Verify authentication token is being sent

**Duplicate messages:**

- Make sure to clean up listeners with `socket.off()` in useEffect cleanup
- Don't call `onNewMessage` multiple times without cleanup
