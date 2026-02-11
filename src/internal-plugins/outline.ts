import InternalPluginInjector from '@app/@types/internal-plugin-injector';
import { createIconShortcodeRegex } from '@app/editor/markdown-processors';
import svg from '@app/lib/util/svg';
import icon from '@app/lib/icon';
import { LoggerPrefix, logger } from '@app/lib/logger';
import IconizePlugin from '@app/main';
import { requireApiVersion, View, WorkspaceLeaf } from 'obsidian';

const TREE_ITEM_CLASS = 'tree-item-self';
const TREE_ITEM_INNER = 'tree-item-inner';

interface OutlineLeaf extends WorkspaceLeaf {
  view: OutlineView;
}

interface OutlineView extends View {
  tree: {
    containerEl: HTMLDivElement;
  };
}

export default class OutlineInternalPlugin extends InternalPluginInjector {
  private observer: MutationObserver | null = null;
  private cachedIconShortcodeRegex: RegExp | null = null;
  private cachedNavItemSize: number | null = null;

  constructor(plugin: IconizePlugin) {
    super(plugin);
  }

  onMount(): void {
    // TODO: Might improve the performance here.
  }

  private getIconShortcodeRegex(): RegExp {
    if (!this.cachedIconShortcodeRegex) {
      this.cachedIconShortcodeRegex = createIconShortcodeRegex(this.plugin);
    }
    return this.cachedIconShortcodeRegex;
  }

  private getNavItemSize(): number {
    if (this.cachedNavItemSize === null) {
      this.cachedNavItemSize = parseFloat(
        getComputedStyle(document.body).getPropertyValue('--nav-item-size') ??
          '16',
      );
    }
    return this.cachedNavItemSize;
  }

  register(): void {
    if (!this.enabled) {
      logger.info(
        'Skipping internal plugin registration because it is not enabled.',
        LoggerPrefix.Outline,
      );
      return;
    }

    // Prevent duplicate registrations — disconnect previous observer first.
    if (this.registered && this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
    this.registered = true;

    const processTreeItems = (root: Element) => {
      const treeItems = Array.from(
        root.querySelectorAll(`.${TREE_ITEM_CLASS}`),
      );
      for (const treeItem of treeItems) {
        const treeItemInner = treeItem.querySelector(`.${TREE_ITEM_INNER}`);
        this.processTreeItemInner(treeItemInner);
      }
    };

    const setOutlineIcons = () => {
      this.plugin.getEventEmitter().once('allIconsLoaded', () => {
        // Invalidate caches when icons reload.
        this.cachedIconShortcodeRegex = null;
        this.cachedNavItemSize = null;

        processTreeItems(this.leaf.view.tree.containerEl);

        const callback = (mutations: MutationRecord[]) => {
          if (!this.enabled) {
            this.observer?.disconnect();
            this.observer = null;
            return;
          }

          // Process only added nodes from mutation records.
          for (const mutation of mutations) {
            if (
              mutation.type !== 'childList' ||
              mutation.addedNodes.length === 0
            ) {
              continue;
            }

            const addedNodes = Array.from(mutation.addedNodes);
            for (const node of addedNodes) {
              if (!(node instanceof HTMLElement)) {
                continue;
              }

              // Check if the added node itself is a tree item.
              if (node.classList?.contains(TREE_ITEM_CLASS)) {
                const inner = node.querySelector(`.${TREE_ITEM_INNER}`);
                this.processTreeItemInner(inner);
              } else {
                // Check children of the added node.
                const items = Array.from(
                  node.querySelectorAll(`.${TREE_ITEM_CLASS}`),
                );
                for (const item of items) {
                  const inner = item.querySelector(`.${TREE_ITEM_INNER}`);
                  this.processTreeItemInner(inner);
                }
              }
            }
          }
        };

        this.observer = new MutationObserver(callback);
        this.observer.observe(this.leaf.view.tree.containerEl, {
          childList: true,
          subtree: true,
        });
      });
    };

    if (requireApiVersion('1.7.2')) {
      this.leaf.loadIfDeferred().then(setOutlineIcons);
    } else {
      setOutlineIcons();
    }
  }

  private processTreeItemInner(treeItemInner: Element | null): void {
    if (!treeItemInner) {
      return;
    }

    let text = treeItemInner.getText();
    if (!text) {
      return;
    }

    const iconShortcodeRegex = this.getIconShortcodeRegex();
    const iconIdentifierLength =
      this.plugin.getSettings().iconIdentifier.length;

    let trimmedLength = 0;
    for (const code of [...text.matchAll(iconShortcodeRegex)]
      .sort((a, b) => a.index - b.index)
      .map((arr) => ({ text: arr[0], index: arr.index! }))) {
      const shortcode = code.text;
      const iconName = shortcode.slice(
        iconIdentifierLength,
        shortcode.length - iconIdentifierLength,
      );
      const iconObject = icon.getIconByName(this.plugin, iconName);
      if (iconObject) {
        const startIndex = code.index - trimmedLength;
        const endIndex = code.index + code.text.length - trimmedLength;

        const str = text.substring(0, startIndex) + text.substring(endIndex);

        const iconSpan = createSpan({
          cls: 'cm-iconize-icon',
          attr: {
            'aria-label': iconName,
            'data-icon': iconName,
            'aria-hidden': 'true',
          },
        });
        const fontSize = this.getNavItemSize();
        const svgElement = svg.setFontSize(iconObject.svgElement, fontSize);
        iconSpan.style.display = 'inline-flex';
        iconSpan.style.transform = 'translateY(13%)';
        iconSpan.innerHTML = svgElement;
        treeItemInner.innerHTML = treeItemInner.innerHTML.replace(
          shortcode,
          iconSpan.outerHTML,
        );

        text = str;
        trimmedLength += code.text.length;
      }
    }
  }

  get leaf(): OutlineLeaf | undefined {
    const leaf = this.plugin.app.workspace.getLeavesOfType('outline');
    if (!leaf) {
      logger.log('`leaf` in outline is undefined', LoggerPrefix.Outline);
      return undefined;
    }

    if (leaf.length === 0) {
      logger.log('`leaf` length in outline is 0', LoggerPrefix.Outline);
      return undefined;
    }

    return leaf[0] as OutlineLeaf;
  }

  get outline() {
    return this.plugin.app.internalPlugins.getPluginById('outline');
  }

  get enabled(): boolean {
    return this.plugin.app.internalPlugins.getPluginById('outline').enabled;
  }
}
