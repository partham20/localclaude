// End-to-end steps for 1.4: the first-run setup screen (three ways to sign in), picking a look,
// Settings → Appearance and Keyboard, the command palette, and a mod with a script.
// The app starts signed out (LOCALCLAUDE_FAKE_SIGNED_OUT) with an empty mods folder.

const TOKEN = 'sk-ant-oat01-TEST-ONLY-not-a-real-token-for-e2e'
const KEY = 'sk-ant-api03-TEST-ONLY-not-a-real-key-for-e2e'

/** Read a CSS variable as the page resolved it. */
const cssVar = (name) => `getComputedStyle(document.documentElement).getPropertyValue('--${name}').trim()`

export const steps = [
  {
    name: 'setup: signed out, the three ways to sign in',
    run: async (c) => {
      await c.waitFor('the setup screen', "!!__t.q('.setup-card') && __t.qa('.method').length === 3")
      const titles = await c.page("__t.qa('.method b').map((e) => e.innerText)")
      for (const t of ['Claude subscription', 'Auth token', 'Console API key'])
        if (!titles.some((x) => x.startsWith(t))) throw new Error(`missing "${t}" in ${JSON.stringify(titles)}`)
      if (!(await c.page("__t.q('.method.on')?.dataset.method === 'subscription'"))) throw new Error('the subscription should be picked to start with')
      // the app's shortcuts don't work before you've signed in
      await c.page("__t.key(window, 'k', { ctrlKey: true, code: 'KeyK' })")
      if (await c.page("!!__t.q('.palette')")) throw new Error('the command palette opened on the setup screen')
      await c.shot('setup-choose')
    }
  },
  {
    name: 'setup: a token that isn’t one is refused with a hint, then a real token signs in',
    run: async (c) => {
      await c.page("__t.click(__t.q('.method[data-method=\"token\"]'))")
      await c.page("__t.click(__t.q('.setup-continue'))")
      await c.waitFor('the token page', "__t.text('.step-head h2') === 'Paste an auth token' && !!__t.q('.secret-input input[type=password]')")
      await c.page(`__t.setValue(__t.q('.secret-input input'), ${JSON.stringify(KEY)})`)
      await c.page("__t.click(__t.q('.setup-form button[type=submit]'))")
      await c.waitFor('the hint', "__t.text('.setup-error').includes('Console API key')")
      // back, and the choice is remembered
      await c.page("__t.click(__t.q('.step-head .icon-btn'))")
      await c.waitFor('the choices again', "__t.q('.method.on')?.dataset.method === 'token'")
      await c.page("__t.click(__t.q('.setup-continue'))")
      await c.waitFor('the token page', "!!__t.q('.secret-input input')")
      await c.page(`__t.setValue(__t.q('.secret-input input'), ${JSON.stringify(TOKEN)})`)
      await c.page("__t.click(__t.q('.setup-form button[type=submit]'))")
      await c.waitFor('signed in: pick a look', "__t.text('.setup-hero h1').includes('Make it yours')")
      if (await c.page(`document.body.innerHTML.includes(${JSON.stringify(TOKEN)})`)) throw new Error('the token is still in the page')
      await c.shot('setup-personalize')
    }
  },
  {
    name: 'setup: pick a theme, dark mode and an accent, then start',
    run: async (c) => {
      await c.page("__t.click(__t.byText('.setup-theme', 'Nord'))")
      await c.page("__t.click(__t.byText('.seg', 'Dark'))")
      await c.waitFor('Nord, dark', `document.documentElement.dataset.theme === 'dark' && ${cssVar('bg')} === '#2e3440'`)
      await c.page("__t.click(__t.q('.swatch[aria-label=\"Accent #ec4899\"]'))")
      await c.waitFor('the pink accent', `${cssVar('accent')} === '#ec4899'`)
      await c.page("__t.click(__t.q('.setup-continue'))")
      await c.waitFor('the app', "!!__t.q('.sidebar') && !__t.q('.setup-card')")
      await c.shot('after-setup')
    }
  },
  {
    name: 'Settings → Account: the saved token signs in, and signing out goes back to the setup screen',
    run: async (c) => {
      await c.openSettings('Account')
      await c.waitFor('the sign-in', "__t.text('.kv').includes('Subscription token (saved in LocalClaude)')")
      await c.page("__t.click(__t.byText('.modal-body .btn.danger', 'Sign out'))")
      await c.waitFor('the setup screen', "!!__t.q('.setup-card') && __t.qa('.method').length === 3")
    }
  },
  {
    name: 'setup: a Console API key with no subscription',
    run: async (c) => {
      await c.page("__t.click(__t.q('.method[data-method=\"apiKey\"]'))")
      await c.page("__t.click(__t.q('.setup-continue'))")
      await c.waitFor('the key page', "__t.text('.step-head h2') === 'Use a Console API key'")
      await c.page(`__t.setValue(__t.q('.secret-input input'), ${JSON.stringify(KEY)})`)
      await c.page("__t.click(__t.q('.setup-form button[type=submit]'))")
      await c.waitFor('signed in', "__t.text('.setup-hero h1').includes('Make it yours')")
      await c.page("__t.click(__t.q('.setup-continue'))")
      await c.waitFor('the app, billing the key', "!!__t.q('.sidebar') && __t.text('.account-plan').includes('API key')")
      await c.openSettings('Account')
      await c.waitFor('key only', "__t.text('.kv').includes('Console API key only') && __t.text('.console-key-note').includes('Everything bills this key')")
      if (await c.page("!!__t.q('.oauth-token')")) throw new Error('no subscription token field when signed in with a key only')
      await c.closeModal()
    }
  },
  {
    name: 'setup: the browser sign-in',
    run: async (c) => {
      await c.openSettings('Account')
      await c.page("__t.click(__t.byText('.modal-body .btn.danger', 'Sign out'))")
      await c.waitFor('the setup screen', "!!__t.q('.setup-card') && __t.qa('.method').length === 3")
      await c.page("__t.click(__t.q('.setup-continue'))")
      await c.waitFor('the subscription page', "__t.text('.step-head h2').includes('Claude subscription')")
      await c.page("__t.click(__t.byText('.btn', 'Open the browser'))")
      await c.waitFor('signed in', "__t.text('.setup-hero h1').includes('Make it yours')")
      await c.until('the sign-in page opened in the browser', () => c.opened.some((u) => u.includes('oauth')))
      await c.page("__t.click(__t.q('.setup-continue'))")
      await c.waitFor('the app', "!!__t.q('.sidebar')")
    }
  },
  {
    name: 'Appearance: themes, colors, sizes, layout and your own CSS',
    run: async (c) => {
      await c.openSettings('Appearance')
      await c.waitFor('theme cards', "__t.qa('.theme-card').length >= 9")
      await c.page("__t.click(__t.q('.theme-card[data-theme-id=\"forest\"]'))")
      await c.page("__t.click(__t.byText('.seg', 'Light'))")
      await c.waitFor('Forest, light', `document.documentElement.dataset.theme === 'light' && ${cssVar('bg')} === '#f6f8f4' && ${cssVar('accent')} === '#ec4899'`)
      await c.page("__t.click(__t.q('.swatch.theme-own'))")
      await c.waitFor('the theme’s own accent', `${cssVar('accent')} === '#2f8f5f'`)
      await c.page("__t.click(__t.byText('.seg', 'Compact'))")
      await c.page("__t.click(__t.byText('.seg', 'Round'))")
      await c.waitFor('compact and round', "document.documentElement.dataset.density === 'compact' && document.documentElement.dataset.corners === 'round'")
      // every color can be changed
      await c.page("__t.click(__t.byText('.btn', 'Change any color'))")
      await c.waitFor('color pickers', "__t.qa('.color-token').length >= 16")
      await c.page(`(() => { const el = __t.byText('.color-token', 'Sidebar').querySelector('input'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, '#ff00aa'); el.dispatchEvent(new Event('input', { bubbles: true })); return true })()`)
      await c.waitFor('your sidebar color', `${cssVar('sidebar')} === '#ff00aa'`)
      // your own CSS goes on the page
      await c.page("__t.setValue(__t.q('.custom-css'), '.sidebar { outline: 3px solid rgb(1, 2, 3); }')")
      await c.page("__t.q('.custom-css').dispatchEvent(new FocusEvent('focusout', { bubbles: true })); true")
      await c.waitFor('your CSS', "getComputedStyle(__t.q('.sidebar')).outlineColor === 'rgb(1, 2, 3)'")
      await c.shot('appearance')
      await c.page("__t.click(__t.byText('.btn', 'Reset everything'))")
      await c.waitFor('back to the defaults', `document.documentElement.dataset.density === 'comfortable' && ${cssVar('sidebar')} === '#f5f4ee' && getComputedStyle(__t.q('.sidebar')).outlineStyle === 'none'`)
      await c.closeModal()
    }
  },
  {
    name: 'Keyboard: change a shortcut, use it, and see a clash',
    run: async (c) => {
      await c.openSettings('Keyboard')
      await c.page("__t.click(__t.q('.key-row[data-action=\"newChat\"] .key-chip'))")
      await c.waitFor('recording', "__t.text('.key-row[data-action=\"newChat\"] .key-chip') === 'Press keys…'")
      await c.page("__t.key(window, 'J', { ctrlKey: true, shiftKey: true, code: 'KeyJ' })")
      await c.waitFor('the new shortcut', "__t.text('.key-row[data-action=\"newChat\"] .key-chip') === 'Ctrl+Shift+J'")
      await c.page("__t.click(__t.q('.key-row[data-action=\"settings\"] .key-chip'))")
      await c.page("__t.key(window, 'J', { ctrlKey: true, shiftKey: true, code: 'KeyJ' })")
      await c.waitFor('the clash shown', "!!__t.q('.key-row.clash') && __t.text('.key-row[data-action=\"settings\"]').includes('Also used by New chat')")
      await c.page("__t.click(__t.q('.key-row[data-action=\"settings\"] .icon-btn'))")
      await c.waitFor('settings back to Ctrl+,', "__t.text('.key-row[data-action=\"settings\"] .key-chip') === 'Ctrl+,' && !__t.q('.key-row.clash')")
      await c.closeModal()
      const before = await c.page("__t.qa('.session-item').length")
      await c.page("__t.key(window, 'J', { ctrlKey: true, shiftKey: true, code: 'KeyJ' })")
      await c.waitFor('a new chat from the new shortcut', `__t.qa('.session-item').length === ${before + 1} || !!__t.q('.composer-input')`)
    }
  },
  {
    name: 'command palette: find a theme and switch to it',
    run: async (c) => {
      await c.page("__t.key(window, 'k', { ctrlKey: true, code: 'KeyK' })")
      await c.waitFor('the palette', "!!__t.q('.palette-input')")
      await c.page("__t.setValue(__t.q('.palette-input'), 'theme rose')")
      await c.waitFor('Rosé first', "__t.text('.palette-item.selected').includes('Theme: Rosé')")
      await c.shot('palette')
      await c.page("__t.key(__t.q('.palette-input'), 'Enter')")
      await c.waitFor('Rosé on', `!__t.q('.palette') && ${cssVar('accent')} === '#b4637a'`)
    }
  },
  {
    name: 'mods: add the example, switch it on, and its theme, command, sidebar button and status item work',
    run: async (c) => {
      await c.openSettings('Mods')
      await c.waitFor('no mods yet', "!!__t.q('.mods-empty')")
      await c.page("__t.click(__t.byText('.btn', 'Add the example mod'))")
      await c.waitFor('the example mod', "!!__t.q('.mod-card[data-mod=\"example-mod\"]') && __t.text('.mod-tags').includes('Script')")
      await c.page('window.confirm = () => true; true')
      await c.page("__t.click(__t.q('.mod-card[data-mod=\"example-mod\"] .switch input'))")
      await c.waitFor('running', "__t.text('.mod-card[data-mod=\"example-mod\"] .mod-tags').includes('Running')", 15000)
      await c.waitFor('its CSS on the page', "[...document.querySelectorAll('style[data-mod=\"example-mod\"]')].some((s) => s.textContent.includes('.titlebar'))")
      await c.shot('mods')
      // its theme shows up with the others
      await c.page("__t.click(__t.byText('.nav-item', 'Appearance'))")
      await c.waitFor('the Ocean theme', "!!__t.q('.theme-card[data-theme-id=\"example-mod/ocean\"]')")
      await c.page("__t.click(__t.q('.theme-card[data-theme-id=\"example-mod/ocean\"]'))")
      await c.waitFor('Ocean on', `${cssVar('accent')} === '#0e7490'`)
      await c.closeModal()
      // its sidebar button runs its command, which shows a toast
      await c.page("__t.click(__t.byText('.side-nav', 'Example mod'))")
      await c.waitFor('the toast', "__t.text('.toast').includes('Hello from the example mod')")
      // its shortcut works too, and the status item counts finished replies
      await c.page("__t.key(window, 'H', { ctrlKey: true, shiftKey: true, code: 'KeyH' })")
      await c.waitFor('a status item', "__t.text('.side-status').includes('0 replies')")
      await c.send('hello mods', 'Echo: hello mods')
      await c.waitFor('one reply counted', "__t.text('.side-status').includes('1 reply')")
      // switched off, everything it added goes away, and its theme goes with it
      await c.openSettings('Mods')
      await c.page("__t.click(__t.q('.mod-card[data-mod=\"example-mod\"] .switch input'))")
      await c.waitFor('gone', "!__t.q('style[data-mod]') && !__t.q('.side-status') && !__t.byText('.side-nav', 'Example mod')")
      await c.closeModal()
    }
  }
]
