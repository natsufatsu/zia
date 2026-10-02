  let workspaceSlot = null;
  let spaceLabel = null;
  let spaceLabelRequest = 0;
  const spaceIconCache = new Map();
  let movedIndicator = null;
  let movedFromSpace = null;
  let spaceAttrObserver = null;
  const MIRRORED_SPACE_ATTRS = ["haspinnedtabs", "collapsedpinnedtabs"];

  function createWorkspaceSlot() {
    const topButtons = document.getElementById("zen-sidebar-top-buttons");
    if (!topButtons || !window.gZenWorkspaces) {
      return;
    }
    workspaceSlot = document.createElementNS("http://www.w3.org/1999/xhtml", "div");
    workspaceSlot.id = "zia-workspace-slot";
    const buttonBox = topButtons.querySelector(".titlebar-buttonbox-container");
    if (buttonBox) {
      buttonBox.after(workspaceSlot);
    } else {
      topButtons.prepend(workspaceSlot);
    }

    let queued = false;
    const onSpaceSwitch = () => {
      if (queued) {
        return;
      }
      queued = true;
      queueMicrotask(() => {
        queued = false;
        if (!window.closed) {
          warmSpaceIcons();
          placeWorkspaceIndicator();
        }
      });
    };
    for (const type of ["ZenWorkspacesUIUpdate", "ZenWorkspaceDataChanged", "AfterWorkspacesSessionRestore"]) {
      window.addEventListener(type, onSpaceSwitch);
    }
    Services.prefs.addObserver("zen.workspaces.active", onSpaceSwitch);
    window.addEventListener("unload", () => Services.prefs.removeObserver("zen.workspaces.active", onSpaceSwitch));
    gBrowser.tabContainer.addEventListener("TabSelect", onSpaceSwitch);
    placeWorkspaceIndicator();
    warmSpaceIcons();

    setTimeout(onSpaceSwitch, 500);
    setTimeout(onSpaceSwitch, 2000);
  }

  const XHTML_NS = "http://www.w3.org/1999/xhtml";

  function syncSpaceLabel(indicator) {
    if (!indicator) {
      return;
    }
    let workspace = null;
    try {
      workspace = gZenWorkspaces.getActiveWorkspace();
    } catch (err) {
      return;
    }
    if (!workspace) {
      return;
    }

    let label = spaceLabel || indicator.querySelector("#zia-space-label");
    if (!label) {
      label = document.createElementNS(XHTML_NS, "div");
      label.id = "zia-space-label";
    }
    spaceLabel = label;
    if (label.parentNode !== indicator) {
      indicator.prepend(label);
    }

    const rawIcon = typeof workspace.icon === "string" ? workspace.icon : "";

    const visibleIcon = rawIcon.replace(/[\s\u200b-\u200f\u2060\ufe00-\ufe0f\p{Cf}]/gu, "");
    const hasIcon = visibleIcon !== "";
    const icon = hasIcon ? rawIcon.trim() : "";

    const blank = /^[\s\u200b-\u200f\u2060\ufe00-\ufe0f]+|[\s\u200b-\u200f\u2060\ufe00-\ufe0f]+$/gu;
    let text = label.querySelector(".zia-space-name");
    if (!text) {
      label.textContent = "";
      text = document.createElementNS(XHTML_NS, "span");
      text.className = "zia-space-name";
      label.appendChild(text);
    }
    const name = (workspace.name || "").replace(blank, "");
    const request = ++spaceLabelRequest;
    const apply = (svg) => {
      text.textContent = name;
      const mark = label.querySelector(".zia-space-svg");
      label.removeAttribute("zia-icon");
      label.removeAttribute("zia-has-icon");
      label.removeAttribute("zia-has-svg");
      if (!hasIcon || (icon.endsWith(".svg") && !svg)) {
        mark?.remove();
        return;
      }
      if (!icon.endsWith(".svg")) {
        mark?.remove();
        label.setAttribute("zia-icon", icon);
        label.setAttribute("zia-has-icon", "true");
        return;
      }
      label.setAttribute("zia-has-svg", "true");
      let svgSlot = mark;
      if (!svgSlot) {
        svgSlot = document.createElementNS(XHTML_NS, "span");
        svgSlot.className = "zia-space-svg";
        label.prepend(svgSlot);
      }
      if (svgSlot.dataset.src !== icon || !svgSlot.firstChild) {
        svgSlot.replaceChildren(svg.cloneNode(true));
        svgSlot.dataset.src = icon;
      }
    };
    if (!hasIcon || !icon.endsWith(".svg") || !isOwnIconUrl(icon)) {
      apply(null);
      return;
    }
    const entry = readSpaceIcon(icon);
    if (entry.node) {
      apply(entry.node);
      return;
    }
    // Keep the complete previous label while a new icon is being loaded.
    // Cached icons are replaced synchronously, before the next browser paint.
    if (!text.textContent) {
      text.textContent = name;
    }
    entry.promise.then((node) => {
      if (request === spaceLabelRequest && label.isConnected) {
        apply(node);
      }
    });
  }

  function warmSpaceIcons() {
    for (const workspace of window.gZenWorkspaces?.getWorkspaces?.() || []) {
      const icon = typeof workspace.icon === "string" ? workspace.icon.trim() : "";
      if (icon.endsWith(".svg") && isOwnIconUrl(icon)) {
        readSpaceIcon(icon);
      }
    }
  }

  function readSpaceIcon(icon) {
    const cached = spaceIconCache.get(icon);
    if (cached) {
      return cached;
    }
    const entry = { node: null, promise: null };
    spaceIconCache.set(icon, entry);
    entry.promise = fetch(icon)
      .then((response) => response.text())
      .then((source) => {
        const colored = source
          .replace(/context-fill-opacity/g, "1")
          .replace(/context-stroke-opacity/g, "1")
          .replace(/context-fill/g, "currentColor")
          .replace(/context-stroke/g, "currentColor")
          .replace(/\bfill="(?:#000(?:000)?|black)"/gi, 'fill="currentColor"')
          .replace(/\bstroke="(?:#000(?:000)?|black)"/gi, 'stroke="currentColor"')
          .replace(/fill\s*:\s*(?:#000(?:000)?|black)/gi, "fill:currentColor")
          .replace(/stroke\s*:\s*(?:#000(?:000)?|black)/gi, "stroke:currentColor");
        const parsed = new DOMParser().parseFromString(colored, "image/svg+xml");
        const node = parsed.documentElement;
        if (!node || node.localName !== "svg") {
          throw new Error("Invalid workspace SVG");
        }
        cleanSvg(node);
        entry.node = document.importNode(node, true);
        return entry.node;
      })
      .catch(() => {
        // A resource mapping may not exist yet during the first icon-pack
        // startup. Drop failures so the next update can try again.
        spaceIconCache.delete(icon);
        return null;
      });
    return entry;
  }

  const OWN_ICON_SCHEMES = ["chrome:", "resource:"];

  function isOwnIconUrl(icon) {
    try {
      return OWN_ICON_SCHEMES.includes(new URL(icon, "chrome://browser/content/browser.xhtml").protocol);
    } catch (err) {
      return false;
    }
  }

  // An icon is only shapes: drop anything that could run or load something
  // before it goes into the browser's own window.
  function cleanSvg(svg) {
    for (const node of svg.querySelectorAll("script, foreignObject, iframe, embed, object, audio, video")) {
      node.remove();
    }
    for (const node of [svg, ...svg.querySelectorAll("*")]) {
      for (const attr of [...node.attributes]) {
        const name = attr.name.toLowerCase();
        const value = attr.value.trim().toLowerCase();
        const isLink = name === "href" || name.endsWith(":href") || name === "src";
        if (name.startsWith("on") || (isLink && !value.startsWith("#")) || value.startsWith("javascript:")) {
          node.removeAttributeNode(attr);
        }
      }
    }
  }

  function removeSpaceLabel(indicator) {
    indicator?.querySelector("#zia-space-label")?.remove();
  }

  function mirrorSpaceAttributes(space) {
    for (const name of MIRRORED_SPACE_ATTRS) {
      if (space?.hasAttribute(name)) {
        workspaceSlot.setAttribute(name, space.getAttribute(name));
      } else {
        workspaceSlot.removeAttribute(name);
      }
    }
  }

  function placeWorkspaceIndicator() {
    if (!workspaceSlot) {
      return;
    }
    let space = null;
    let indicator = null;
    try {
      space = gZenWorkspaces.activeWorkspaceElement;
      indicator = space?.indicator;
    } catch (err) {
      return;
    }

    if (movedIndicator && movedIndicator !== indicator && movedFromSpace?.isConnected) {
      removeSpaceLabel(movedIndicator);
      movedFromSpace.prepend(movedIndicator);
      movedIndicator = null;
      movedFromSpace = null;
    }

    if (indicator && indicator.parentNode !== workspaceSlot) {
      workspaceSlot.append(indicator);
      movedIndicator = indicator;
      movedFromSpace = space;
    }

    syncSpaceLabel(indicator);

    spaceAttrObserver?.disconnect();
    mirrorSpaceAttributes(space);
    if (space) {
      spaceAttrObserver = new MutationObserver(() => mirrorSpaceAttributes(space));
      spaceAttrObserver.observe(space, { attributes: true, attributeFilter: MIRRORED_SPACE_ATTRS });
    }
    setFlag("zia-workspace-slot", !!indicator);
  }

