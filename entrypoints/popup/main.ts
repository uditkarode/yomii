import type { Message, PageState } from '@/utils/messages';
import { autoHighlight } from '@/utils/settings';

const autoSwitch = document.querySelector<HTMLInputElement>('#auto')!;
const pageButton = document.querySelector<HTMLButtonElement>('#page')!;

const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
let pageEnabled = false;

async function sendToPage(message: Message): Promise<PageState | undefined> {
  if (tab?.id === undefined) return undefined;
  try {
    return await browser.tabs.sendMessage(tab.id, message);
  } catch {
    return undefined;
  }
}

function renderPageButton(state: PageState | undefined) {
  if (!state) {
    pageButton.disabled = true;
    pageButton.textContent = 'Not available on this page';
    return;
  }
  pageEnabled = state.enabled;
  pageButton.disabled = false;
  pageButton.textContent = state.enabled ? 'Remove highlights from this page' : 'Highlight this page';
}

autoSwitch.checked = await autoHighlight.getValue();
autoSwitch.addEventListener('change', async () => {
  await autoHighlight.setValue(autoSwitch.checked);
  renderPageButton(await sendToPage({ type: 'set-enabled', enabled: autoSwitch.checked }));
});
pageButton.addEventListener('click', async () => {
  renderPageButton(await sendToPage({ type: 'set-enabled', enabled: !pageEnabled }));
});
renderPageButton(await sendToPage({ type: 'get-state' }));
