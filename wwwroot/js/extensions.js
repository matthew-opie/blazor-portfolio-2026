let prevScrollPos = window.pageYOffset;

window.onscroll = () => {
    const currentScrollPos = window.pageYOffset;
    document.getElementById("contextBar").style.top =
        prevScrollPos > currentScrollPos ? "0" : "-100px";
    prevScrollPos = currentScrollPos;
}

window.notifications = {
    isSupported: () => 'Notification' in window,
    getPermission: () => Notification.permission,
    requestPermission: async () => await Notification.requestPermission(),
    show: (title, body, icon) => {
        if (Notification.permission === 'granted') {
            new Notification(title, { body, icon });
        }
        if (navigator.vibrate) {
            navigator.vibrate([100, 200, 100]);
        }
    }
};