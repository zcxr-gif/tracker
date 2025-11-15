document.addEventListener('DOMContentLoaded', () => {
    // This script runs after the main flight.js has built the DOM.
    // We wait a moment to ensure the toolbar buttons are created.
    
    setTimeout(() => {
        const weatherBtn = document.getElementById('open-weather-settings-btn');
        
        if (weatherBtn) {
            // 1. Change the icon to a lock
            const icon = weatherBtn.querySelector('.fa-solid');
            if (icon) {
                icon.classList.remove('fa-cloud-sun');
                icon.classList.add('fa-lock');
            }
            
            // 2. Change the hover-over title
            weatherBtn.title = "Weather Settings (Work in Progress)";
            
            // 3. Replace the button with a copy of itself.
            // This is the simplest way to remove all existing event listeners (like the one that opens the window).
            const newBtn = weatherBtn.cloneNode(true);
            weatherBtn.parentNode.replaceChild(newBtn, weatherBtn);
            
            // 4. Add our new "locked" click listener
            newBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                
                // Call the globally-exposed notification function from flight.js
                if (typeof window.showGlobalNotification === 'function') {
                    window.showGlobalNotification('Weather feature is locked.', 'info');
                } else {
                    // Fallback in case the global function isn't found
                    alert('Weather is locked.');
                }
            });

        }

        // 5. Hide the actual weather window so it can't be opened in any other way
        const weatherWindow = document.getElementById('weather-settings-window');
        if (weatherWindow) {
            // We remove it from the DOM entirely so it can't be manipulated
            weatherWindow.remove();
        }

    }, 500); // Wait 500ms for flight.js to finish building the toolbar
});