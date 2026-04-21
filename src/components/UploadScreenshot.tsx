import { call } from "@decky/api";
import { DialogButton, Dropdown, DropdownOption } from "@decky/ui";
import { useEffect, useState } from "react";

function urlContentToDataUri(url: string) {
  return fetch(url)
    .then((response) => response.blob())
    .then(
      (blob) =>
        new Promise((callback) => {
          let reader = new FileReader();
          reader.onload = function () {
            callback(this.result);
          };
          reader.readAsDataURL(blob);
        })
    );
}

export function UploadScreenshot() {
  const [screenshot, setScreenshot] = useState<any>();
  const [selectedChannel, setChannel] = useState<any>();
  const [channels, setChannels] = useState<DropdownOption[]>([]);
  const [uploadButtonDisabled, setUploadButtonDisabled] =
    useState<boolean>(false);

  useEffect(() => {
    call<[], Record<string, any>>("get_last_channels")
      .then(res => {
        if (!res || "error" in res)
          return;
        const nextChannels: DropdownOption[] = Object.entries(res).map(([channelId, label]) => ({
          data: channelId,
          label: String(label),
        }));
        setChannels(nextChannels);
        if (nextChannels.length > 0) {
          setChannel(nextChannels[0].data);
        }
      });

    SteamClient.Screenshots.GetLastScreenshotTaken().then((res: any) => setScreenshot(res));
  }, []);

  return (
    <div>
      <img
        width={240}
        height={160}
        src={"https://steamloopback.host/" + screenshot?.strUrl}
      ></img>
      <Dropdown
        menuLabel="Last Channels"
        selectedOption={selectedChannel}
        rgOptions={channels}
        onChange={(e: { data: any; }) => {
          setChannel(e.data);

          if (window.location.pathname == "/routes/discord") {
            window.DISCORD_TAB.m_browserView.SetVisible(true);
            window.DISCORD_TAB.m_browserView.SetFocus(true);
          }
        }}
        onMenuOpened={() => {
          window.DISCORD_TAB.m_browserView.SetVisible(false);
          window.DISCORD_TAB.m_browserView.SetFocus(false);
        }}
      ></Dropdown>
      <DialogButton
        style={{ marginTop: "5px" }}
        disabled={uploadButtonDisabled || !selectedChannel || !screenshot?.strUrl}
        onClick={async () => {
          setUploadButtonDisabled(true);
          try {
            const data = await urlContentToDataUri(`https://steamloopback.host/${screenshot.strUrl}`);
            await call("post_screenshot", selectedChannel, data);
          } finally {
            setUploadButtonDisabled(false);
          }
        }}
      >
        Upload
      </DialogButton>
    </div>
  );
}
