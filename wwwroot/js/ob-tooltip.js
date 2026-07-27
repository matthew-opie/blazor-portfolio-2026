window.obTooltip = {
    _portal: null,
    _hideTimer: null,

    _ensurePortal() {
        if (!this._portal) {
            this._portal = document.createElement('div');
            this._portal.className = 'ob-tooltip-portal';
            this._portal.setAttribute('role', 'tooltip');
            document.body.appendChild(this._portal);
        }
        return this._portal;
    },

    show(element, text, position) {
        if (!element || !text) {
            return;
        }

        clearTimeout(this._hideTimer);

        const portal = this._ensurePortal();
        portal.textContent = text;
        portal.style.display = 'block';
        portal.style.visibility = 'hidden';
        portal.classList.remove('ob-tooltip-portal--visible');

        const rect = element.getBoundingClientRect();
        const portalRect = portal.getBoundingClientRect();
        const margin = 10;
        const viewportW = window.innerWidth;
        const viewportH = window.innerHeight;
        const preferBottom = String(position).toLowerCase() === 'bottom';

        let top;
        if (preferBottom) {
            top = rect.bottom + margin;
            if (top + portalRect.height > viewportH - margin) {
                top = rect.top - portalRect.height - margin;
            }
        } else {
            top = rect.top - portalRect.height - margin;
            if (top < margin) {
                top = rect.bottom + margin;
            }
        }

        let left = rect.left + rect.width / 2 - portalRect.width / 2;
        left = Math.max(margin, Math.min(left, viewportW - portalRect.width - margin));
        top = Math.max(margin, Math.min(top, viewportH - portalRect.height - margin));

        portal.style.top = `${top}px`;
        portal.style.left = `${left}px`;
        portal.style.visibility = 'visible';
        portal.classList.add('ob-tooltip-portal--visible');
    },

    hide() {
        this._hideTimer = setTimeout(() => {
            if (!this._portal) {
                return;
            }

            this._portal.classList.remove('ob-tooltip-portal--visible');
            this._portal.style.display = 'none';
        }, 60);
    }
};
