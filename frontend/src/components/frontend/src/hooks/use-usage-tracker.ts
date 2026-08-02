// frontend/src/hooks/use-usage-tracker.ts
import { useEffect, useRef, useState } from "react";
import { AppState, AppStateStatus } from "react-native";

type UseUsageTrackerOptions = {
  heartbeatSeconds?: number; // how many seconds to send per heartbeat (defaults to 60)
  onLimitReached?: (totalSeconds: number) => void; // callback when limit is reached
  fetchFn?: typeof fetch; // override for testing
};

/**
 * useUsageTracker(sessionToken, options)
 * - sends periodic heartbeats while app is foreground
 * - sends a final heartbeat when app goes to background
 * - returns { activeSeconds } showing the in-memory day's seconds tracked for this session
 */
export default function useUsageTracker(
  sessionToken: string | null,
  options: UseUsageTrackerOptions = {}
) {
  const { heartbeatSeconds = 60, onLimitReached, fetchFn = fetch } = options;
  const activeSecondsRef = useRef<number>(0);
  const [activeSeconds, setActiveSeconds] = useState<number>(0);
  const intervalRef = useRef<any | null>(null);
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);

  useEffect(() => {
    if (!sessionToken) return;

    let mounted = true;

    function sendHeartbeat(seconds: number) {
      if (!sessionToken) return;
      try {
        fetchFn("/api/usage/heartbeat", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${sessionToken}`,
          },
          body: JSON.stringify({ seconds }),
        }).catch((e) => {
          // Ignore network errors; will try again later
          console.warn("Heartbeat failed", e);
        });
      } catch (e) {
        console.warn("Heartbeat exception", e);
      }
    }

    function startInterval() {
      if (intervalRef.current) return;
      intervalRef.current = setInterval(() => {
        activeSecondsRef.current += heartbeatSeconds;
        setActiveSeconds(activeSecondsRef.current);
        sendHeartbeat(heartbeatSeconds);
        if (onLimitReached) onLimitReached(activeSecondsRef.current);
      }, heartbeatSeconds * 1000);
    }

    function stopInterval() {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    }

    const handleAppStateChange = (nextState: AppStateStatus) => {
      const prev = appStateRef.current;
      appStateRef.current = nextState;
      if ((prev === "inactive" || prev === "background") && nextState === "active") {
        // app came to foreground
        startInterval();
      } else if (nextState === "background" || nextState === "inactive") {
        // app going background -> stop and send final heartbeat
        stopInterval();
        // send one more heartbeat for the last interval chunk
        sendHeartbeat(heartbeatSeconds);
      }
    };

    AppState.addEventListener("change", handleAppStateChange);
    // start initially while mounted
    startInterval();

    return () => {
      mounted = false;
      stopInterval();
      AppState.removeEventListener("change", handleAppStateChange);
    };
  }, [sessionToken, heartbeatSeconds, onLimitReached, fetchFn]);

  return { activeSeconds, setActiveSecondsRef: (v: number) => { activeSecondsRef.current = v; setActiveSeconds(v); } };
}
