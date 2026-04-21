import { call, addEventListener, removeEventListener } from "@decky/api";
import { useEffect, useState } from "react";

export function useDeckcordState() {
  const [state, setState] = useState<any | undefined>();

  useEffect(() => {
    call("get_state").then((s) => setState(s));

    const listener = addEventListener("state", (data: any) => {
      setState(data);
    });

    return () => {
      removeEventListener("state", listener);
    };
  }, []);

  return state;
}

export const isLoaded = () =>
  new Promise((resolve) => {
    let done = false;
    const listener = addEventListener("state", (s: any) => {
      if (!done && s.loaded) {
        done = true;
        removeEventListener("state", listener);
        return resolve(true);
      }
    });
    call("get_state").then((s: any) => {
      if (!done && s.loaded) {
        done = true;
        removeEventListener("state", listener);
        resolve(true);
      }
    });
  });

export const isLoggedIn = () =>
  new Promise((resolve) => {
    let done = false;
    const listener = addEventListener("state", (s: any) => {
      if (!done && s.logged_in) {
        done = true;
        removeEventListener("state", listener);
        return resolve(true);
      }
    });
    call("get_state").then((s: any) => {
      if (!done && s.logged_in) {
        done = true;
        removeEventListener("state", listener);
        resolve(true);
      }
    });
  });
