import React, { useRef, useState, useEffect } from 'react';
import io from 'socket.io-client';

const SERVER_URL = 'https://audio-room-full-fina-sih-backend.onrender.com';

const peerConfig = {
  iceServers: [
    { urls: 'stun:stun.relay.metered.ca:80' },
    { urls: 'turn:asia.relay.metered.ca:80', username: '72f03df1b6a58f38d7fd81ab', credential: 'guctVzh/8qDU4KU0' },
    { urls: 'turn:asia.relay.metered.ca:80?transport=tcp', username: '72f03df1b6a58f38d7fd81ab', credential: 'guctVzh/8qDU4KU0' },
    { urls: 'turn:asia.relay.metered.ca:443', username: '72f03df1b6a58f38d7fd81ab', credential: 'guctVzh/8qDU4KU0' },
    { urls: 'turns:asia.relay.metered.ca:443?transport=tcp', username: '72f03df1b6a58f38d7fd81ab', credential: 'guctVzh/8qDU4KU0' }
  ]
};

function App() {
  const [joined, setJoined] = useState(false);
  const [roomId, setRoomId] = useState('');
  const [username, setUsername] = useState('');
  const [role, setRole] = useState('student'); // 'teacher' or 'student'
  const [isMuted, setIsMuted] = useState(false);
  const [remoteStreams, setRemoteStreams] = useState({});
  const [usernames, setUsernames] = useState({});
  const [roles, setRoles] = useState({}); // Map of socketId -> role

  const socketRef = useRef(null);
  const localStreamRef = useRef(null);
  const peerConnections = useRef({});

  const createPeerConnection = (userId, isOffer) => {
    const pc = new RTCPeerConnection(peerConfig);

    localStreamRef.current.getTracks().forEach(track => {
      pc.addTrack(track, localStreamRef.current);
    });

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        socketRef.current.emit('ice-candidate', { target: userId, candidate: event.candidate });
      }
    };

    pc.ontrack = (event) => {
      const stream = event.streams[0];
      setRemoteStreams(prev => ({ ...prev, [userId]: stream }));
    };

    if (isOffer) {
      pc.onnegotiationneeded = async () => {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        socketRef.current.emit('offer', { target: userId, sdp: pc.localDescription });
      };
    }

    return pc;
  };

  const joinRoom = async () => {
    if (!roomId || !username) {
      alert("Please enter Room ID and Username");
      return;
    }

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        sampleRate: 16000,
        sampleSize: 16,
       
      },
      video: false
    });
    localStreamRef.current = stream;

    const socket = io(SERVER_URL);
    socketRef.current = socket;

    socket.on('connect', () => {
      socket.emit('join-room', { roomId, username, role });
    });

    socket.on('all-users', (users) => {
      users.forEach(({ userId, username: uname, role: urole }) => {
        setUsernames(prev => ({ ...prev, [userId]: uname }));
        setRoles(prev => ({ ...prev, [userId]: urole }));
        const pc = createPeerConnection(userId, true);
        peerConnections.current[userId] = pc;
      });
    });

    socket.on('user-joined', ({ userId, username: uname, role: urole }) => {
      setUsernames(prev => ({ ...prev, [userId]: uname }));
      setRoles(prev => ({ ...prev, [userId]: urole }));
      const pc = createPeerConnection(userId, false);
      peerConnections.current[userId] = pc;
    });

    socket.on('offer', async ({ sdp, sender }) => {
      const pc = createPeerConnection(sender, false);
      peerConnections.current[sender] = pc;
      await pc.setRemoteDescription(new RTCSessionDescription(sdp));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      socket.emit('answer', { target: sender, sdp: pc.localDescription });
    });

    socket.on('answer', async ({ sdp, sender }) => {
      const pc = peerConnections.current[sender];
      if (pc) {
        await pc.setRemoteDescription(new RTCSessionDescription(sdp));
      }
    });

    socket.on('ice-candidate', async ({ candidate, sender }) => {
      const pc = peerConnections.current[sender];
      if (pc && candidate) {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
      }
    });

    socket.on('user-left', (userId) => {
      const pc = peerConnections.current[userId];
      if (pc) {
        pc.close();
        delete peerConnections.current[userId];
      }
      setRemoteStreams(prev => {
        const { [userId]: _, ...rest } = prev;
        return rest;
      });
      setUsernames(prev => {
        const { [userId]: _, ...rest } = prev;
        return rest;
      });
      setRoles(prev => {
        const { [userId]: _, ...rest } = prev;
        return rest;
      });
    });

    // Listen for mute commands if this user is a student
    socket.on('mute', () => {
      localStreamRef.current.getAudioTracks().forEach(track => {
        track.enabled = false;
      });
      setIsMuted(true);
    });

    socket.on('unmute', () => {
      localStreamRef.current.getAudioTracks().forEach(track => {
        track.enabled = true;
      });
      setIsMuted(false);
    });

    setJoined(true);
  };

  const toggleMute = () => {
    localStreamRef.current.getAudioTracks().forEach(track => {
      track.enabled = !track.enabled;
    });
    setIsMuted(prev => !prev);
  };

  const handleMuteStudent = (userId) => {
    socketRef.current.emit('mute-student', { target: userId });
  };

  const handleUnmuteStudent = (userId) => {
    socketRef.current.emit('unmute-student', { target: userId });
  };

  return (
    <div style={{ padding: '20px' }}>
      {!joined ? (
        <div>
          <h2>Join Classroom (Audio Only)</h2>
          <input
            type="text"
            placeholder="Enter Room ID"
            value={roomId}
            onChange={e => setRoomId(e.target.value)}
          /><br /><br />
          <input
            type="text"
            placeholder="Enter Username"
            value={username}
            onChange={e => setUsername(e.target.value)}
          /><br /><br />
          <select value={role} onChange={e => setRole(e.target.value)}>
            <option value="student">Student</option>
            <option value="teacher">Teacher</option>
          </select><br /><br />
          <button onClick={joinRoom}>Join Class</button>
        </div>
      ) : (
        <div>
          <button onClick={toggleMute}>
            {isMuted ? 'Unmute' : 'Mute'} Microphone
          </button>
          <h3>Participants:</h3>
          <div>
            {Object.entries(remoteStreams).map(([id, stream]) => (
              <div key={id} style={{ marginBottom: '10px', border: '1px solid #ccc', padding: '5px' }}>
                <p>{usernames[id] || 'Unknown'} ({roles[id]})</p>
                <RemoteAudio stream={stream} />
                {role === 'teacher' && roles[id] === 'student' && (
                  <div>
                    <button onClick={() => handleMuteStudent(id)}>Mute</button>
                    <button onClick={() => handleUnmuteStudent(id)}>Unmute</button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function RemoteAudio({ stream }) {
  const audioRef = useRef();
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.srcObject = stream;
    }
  }, [stream]);
  return <audio ref={audioRef} autoPlay controls />;
}

export default App;
