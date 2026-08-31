interface TauriOpenerApi {
  openUrl?: (url: string) => Promise<void>;
}

interface TauriApi {
  opener?: TauriOpenerApi;
}

type TauriGlobal = typeof globalThis & {
  __TAURI__?: TauriApi;
};

const repositoryUrl = "https://github.com/ArchLinuxStudio/btc-price-monitor";
const repositoryButton = document.querySelector<HTMLButtonElement>("#repository-link")!;
const repositoryStatus = document.querySelector<HTMLSpanElement>("#repository-status")!;

repositoryButton.addEventListener("click", () => {
  const opener = (globalThis as TauriGlobal).__TAURI__?.opener;

  if (typeof opener?.openUrl !== "function") {
    repositoryStatus.textContent = "暂时无法打开 GitHub 仓库";
    return;
  }

  repositoryButton.disabled = true;
  repositoryStatus.textContent = "";

  void opener
    .openUrl(repositoryUrl)
    .catch(() => {
      repositoryStatus.textContent = "暂时无法打开 GitHub 仓库";
    })
    .finally(() => {
      repositoryButton.disabled = false;
    });
});
