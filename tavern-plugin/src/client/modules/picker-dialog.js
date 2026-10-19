// Product pickers use the browser's modal layer, including nested confirmations.
// Business cancellation and draft checks remain with the owner.
function TavernPickerDialog(props) {
    const ref = React.useRef(null);
    React.useLayoutEffect(function () {
        const dialog = ref.current, opener = props.opener || document.activeElement;
        dialog.showModal();
        const first = dialog.querySelector('input:not([type="file"]):not([disabled]), button:not([disabled])');
        (first || dialog).focus({ preventScroll: true });
        return function () {
            if (dialog.open) dialog.close();
            if (opener?.isConnected) opener.focus({ preventScroll: true });
        };
    }, []);
    return React.createElement('dialog', {
        ref, className: 'dsh-tavern-picker-dialog', 'aria-label': props.label,
        'aria-busy': props.busy, tabIndex: -1,
        onCancel: function (event) { event.preventDefault(); if (!props.busy) props.onClose(); },
        onClick: function (event) {
            if (event.target !== event.currentTarget || props.busy) return;
            const box = event.currentTarget.getBoundingClientRect();
            if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) props.onClose();
        }
    }, props.children);
}
