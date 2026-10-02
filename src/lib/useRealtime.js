import { useEffect, useRef, useCallback, useState } from 'react';

/**
 * Custom React hook for CodeXY Realtime Collaboration over WebSockets
 */
export function useRealtime({ projectId, enabled = true, onEdit, onPresence, onStatusChange }) {
  const wsRef = useRef(null);
  const [status, setStatus] = useState('disconnected'); // 'connecting' | 'connected' | 'reconnecting' | 'disconnected'
  const [activeUsers, setActiveUsers] = useState([]);
  const reconnectAttempts = useRef(0);
  const reconnectTimer = useRef(null);
  const pingInterval = useRef(null);
  const isDestroyed = useRef(false);

  const updateStatus = useCallback((newStatus) => {
    setStatus(newStatus);
    if (onStatusChange) onStatusChange(newStatus);
  }, [onStatusChange]);

  const connect = useCallback(() => {
    if (!projectId || !enabled || isDestroyed.current) return;

    // Build WebSocket URL based on VITE_WS_URL or current window location
    const customWsUrl = import.meta.env.VITE_WS_URL;
    let wsUrl;
    if (customWsUrl) {
      const joinChar = customWsUrl.includes('?') ? '&' : '?';
      wsUrl = `${customWsUrl}${joinChar}projectId=${encodeURIComponent(projectId)}`;
    } else {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const host = window.location.host;
      wsUrl = `${protocol}//${host}/api/ws?projectId=${encodeURIComponent(projectId)}`;
    }

    updateStatus(reconnectAttempts.current > 0 ? 'reconnecting' : 'connecting');

    try {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        reconnectAttempts.current = 0;
        updateStatus('connected');

        // Send join event
        ws.send(JSON.stringify({ type: 'join', projectId }));

        // Start ping interval
        if (pingInterval.current) clearInterval(pingInterval.current);
        pingInterval.current = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'ping' }));
          }
        }, 25000);
      };

      ws.onmessage = (event) => {
        let msg;
        try {
          msg = JSON.parse(event.data);
        } catch (e) {
          return;
        }

        if (!msg || typeof msg !== 'object') return;

        switch (msg.type) {
          case 'joined': {
            break;
          }
          case 'edit': {
            if (onEdit) onEdit(msg);
            break;
          }
          case 'presence': {
            if (msg.users && Array.isArray(msg.users)) {
              setActiveUsers(msg.users);
              if (onPresence) onPresence(msg.users);
            }
            break;
          }
          case 'error': {
            console.warn('[REALTIME_WS_WARNING]', msg.error);
            break;
          }
          case 'pong': {
            break;
          }
          default:
            break;
        }
      };

      ws.onclose = () => {
        if (pingInterval.current) clearInterval(pingInterval.current);
        if (isDestroyed.current) return;

        updateStatus('reconnecting');

        // Exponential backoff reconnect: 1s, 2s, 4s, 8s, 10s max
        const backoffMs = Math.min(1000 * Math.pow(2, reconnectAttempts.current), 10000);
        reconnectAttempts.current += 1;

        if (reconnectAttempts.current <= 10) {
          reconnectTimer.current = setTimeout(() => {
            connect();
          }, backoffMs);
        } else {
          updateStatus('disconnected');
        }
      };

      ws.onerror = () => {
        // Will trigger onclose
      };
    } catch (err) {
      updateStatus('disconnected');
    }
  }, [projectId, enabled, onEdit, onPresence, updateStatus]);

  useEffect(() => {
    isDestroyed.current = false;
    connect();

    return () => {
      isDestroyed.current = true;
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      if (pingInterval.current) clearInterval(pingInterval.current);
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [connect]);

  const sendEdit = useCallback((fileId, content) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: 'edit',
        projectId,
        fileId,
        content
      }));
    }
  }, [projectId]);

  const sendCursor = useCallback((fileId, position) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: 'cursor',
        projectId,
        fileId,
        position
      }));
    }
  }, [projectId]);

  const sendSelection = useCallback((fileId, selection) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: 'selection',
        projectId,
        fileId,
        selection
      }));
    }
  }, [projectId]);

  return {
    status,
    activeUsers,
    sendEdit,
    sendCursor,
    sendSelection
  };
}
