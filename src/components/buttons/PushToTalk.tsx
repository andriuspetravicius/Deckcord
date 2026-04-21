import { call, toaster } from "@decky/api";
import { Toggle } from "@decky/ui";
import { useEffect, useRef, useState } from "react";

const PTT_BUTTON = 33;

export function PushToTalkButton() {
  const [pttEnabled, setPtt] = useState<boolean>(false);
  const unregisterPtt = useRef<undefined | (() => void)>(undefined);

  useEffect(() => {
    return () => {
      if (unregisterPtt.current) {
        unregisterPtt.current();
        unregisterPtt.current = undefined;
      }
    };
  }, []);

  return (
    <span style={{ display: "flex" }}>
      PTT:{" "}
      <Toggle
        value={pttEnabled}
        onChange={(checked) => {
          setPtt(checked);
          if (checked) {
            call("enable_ptt", true);
            toaster.toast({
              title: "Push-To-Talk",
              body: "Hold down the R5 button to talk",
            });
            unregisterPtt.current =
              SteamClient.Input.RegisterForControllerInputMessages(
                (events: any) => {
                  for (const event of events)
                    if (event.nA == PTT_BUTTON)
                      call("set_ptt", event.bS);
                }
              ).unregister;
          } else {
            if (unregisterPtt.current) {
              unregisterPtt.current();
              unregisterPtt.current = undefined;
            }
            call("enable_ptt", false);
          }
        }}
      ></Toggle>
    </span>
  );
}
