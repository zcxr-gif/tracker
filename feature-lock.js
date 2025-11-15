document.addEventListener('DOMContentLoaded', () => {
    // This script will now wait for the target elements to be added to the DOM,
    // solving the race condition with the async flight.js.

    // 1. Define the function that applies the lock
    const lockWeatherFeature = (weatherBtn) => {
        // Prevent running the lock more than once
        if (weatherBtn.dataset.locked) return;
        weatherBtn.dataset.locked = 'true';

        console.log('Weather feature lock applied.');

        // 1. Change the icon to a lock
        const icon = weatherBtn.querySelector('.fa-solid');
        if (icon) {
            icon.classList.remove('fa-cloud-sun');
            icon.classList.add('fa-lock');
        }
        
        // 2. Change the hover-over title
        weatherBtn.title = "Weather Settings (Work in Progress)";
        
        // 3. Replace the button with a copy to remove all event listeners
        const newBtn = weatherBtn.cloneNode(true);
        weatherBtn.parentNode.replaceChild(newBtn, weatherBtn);
        
        // 4. Add our new "locked" click listener
        newBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            
            if (typeof window.showGlobalNotification === 'function') {
                window.showGlobalNotification('Weather feature is locked.', 'info');
            } else {
                alert('Weather is locked.');
            }
        });
    };

    // 2. Define the observer
    const observer = new MutationObserver((mutationsList, obs) => {
        let buttonFound = false;
        let windowFound = false;

        // Check if the button we want now exists
        const weatherBtn = document.getElementById('open-weather-settings-btn');
        if (weatherBtn && !weatherBtn.dataset.locked) {
            lockWeatherFeature(weatherBtn);
            buttonFound = true;
        }

        // Check if the window we want to remove now exists
        const weatherWindow = document.getElementById('weather-settings-window');
        if (weatherWindow) {
            weatherWindow.remove();
            windowFound = true;
        }

        // If we've found and locked the button AND removed the window,
        // our job is done. We can stop observing.
        if (buttonFound && windowFound) {
            console.log('Weather lock complete. Disconnecting observer.');
            obs.disconnect();
        }
    });

    // 3. Start observing the entire document for added nodes
    observer.observe(document.body, {
        childList: true, // Watch for new children being added
        subtree: true    // Watch all descendants
    });

    // 4. Run one initial check
    // In the rare case the button *already* exists when this script runs,
    // this will catch it immediately.
    const initialBtn = document.getElementById('open-weather-settings-btn');
    if (initialBtn) {
        lockWeatherFeature(initialBtn);
    }
    const initialWindow = document.getElementById('weather-settings-window');
    if (initialWindow) {
        initialWindow.remove();
    }

    // If both were found immediately, disconnect the observer
    if (initialBtn && initialWindow) {
        console.log('Weather lock complete on initial check. Disconnecting observer.');
        observer.disconnect();
    }
});