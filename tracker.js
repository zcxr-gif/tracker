<!DOCTYPE html>
<html lang="en">
<head>
  <title>InfiniteView Tracker | Flight Tracker for Infinite Flight</title>
  <meta charset="UTF-8">
  <meta http-equiv="X-UA-Compatible" content="ie=edge">
  <link rel="manifest" href="./manifest.json">
  <link rel="icon" type="image/png" href="./resources/ifhubicon.png">
  <link rel="apple-touch-icon" sizes="128x128" href="./resources/ifhubicon.png">
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
  <meta name="application-name" content="InfiniteView">
  <meta name="description" content="InfiniteView Tracker is built for Infinite Flight, a mobile flight simulator. Track flights across all three servers in real-time, view flight schedules and airport traffic, and trending aircraft at a quick glance.">
  <meta property="og:title" content="InfiniteView Tracker" />
  <meta property="og:site_name" content="InfiniteView Tracker">
  <meta property="og:description" content="A Flight Tracker for Infinite Flight" />
  <meta property="og:image" content="https://infiniteview.app/resources/ifhubicon.png" />
  <meta property="og:url" content="https://infiniteview.app"/>
  <meta property="og:type" content="website" />
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet">
  <script src="https://cdnjs.cloudflare.com/ajax/libs/moment.js/2.29.4/moment.min.js"></script>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/Chart.js/2.9.4/Chart.min.js"></script>
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
  <script src="./resources/airportlocationdata.js"></script>
  <script src="./resources/liverydata.js"></script>
  <script src="./resources/airlinecolours.js"></script>
  <style>
  :root {
    --primary-bg: #121212;
    --secondary-bg: #1e1e1e;
    --tertiary-bg: #2d2d2d;
    --card-bg: #252525;
    --accent-color: #FFC300;
    --accent-hover: #ffb700;
    --text-primary: #ffffff;
    --text-secondary: #b0b0b0;
    --text-tertiary: #808080;
    --success-color: #4caf50;
    --warning-color: #ff9800;
    --error-color: #f44336;
    --border-radius-sm: 6px;
    --border-radius-md: 10px;
    --border-radius-lg: 16px;
    --transition-speed: 0.3s;
  }
  :root {
          --primary-bg: #1a1a1a;
          --secondary-bg: #2a2a2a;
          --border-color: #3a3a3a;
          --accent-color: #ffd700;
          --accent-hover: #ffed4a;
          --text-primary: #ffffff;
          --text-secondary: #b0b0b0;
          --text-muted: #808080;
          --flight-path: #404040;
          --completed-path: #ffd700;
          --diversion-color: #ff4444;
          --warning-bg: rgba(255, 68, 68, 0.05);
          --success-color: #22c55e;
      }

  * {
    box-sizing: border-box;
    margin: 0;
    padding: 0;
  }

  html, body {
    height: 100%;
    width: 100%;
    overflow: hidden;
    scrollbar-width: none;
    -ms-overflow-style: none;
  }

  body::-webkit-scrollbar, body::-webkit-scrollbar-button { display: none; } /* Chrome */

  body {
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif;
    background-color: var(--primary-bg);
    color: var(--text-primary);
    line-height: 1.5;
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
  }

  /* Map Markers */
  .marker-container {
    display: inline-block;
  }

  .marker-icon {
    transform-origin: center;
  }

  .airportactive {
    background-image: url("./resources/airportactive.png");
    background-size: cover;
    width: 25px;
    height: 33px;
    cursor: pointer;
  }

  .airportnotactive {
    background-image: url("./resources/airportnotactive.png");
    background-size: cover;
    width: 25px;
    height: 33px;
    cursor: pointer;
    opacity: 0.8;
  }

  .clickedplaneicon {
    background-image: url("./resources/airportclicked.png");
    background-size: cover;
    border-radius: 25%;
    cursor: pointer;
  }

  .planeicon {
    background-image: url("./resources/testplaneicon.png");
    background-size: cover;
    border-radius: 25%;
    cursor: pointer;
  }

  /* Container Styles */
  .container {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 2px;
    background-color: var(--secondary-bg);
    padding: 2px;
    padding-bottom: 60px;
    border-radius: var(--border-radius-lg);
    border-color: white;
    border-width: thin;
    scrollbar-width: none;
    width: 100%;
  }

  .container > div {
    background-color: var(--card-bg);
    padding: 8px;
    border-radius: var(--border-radius-md);
    text-align: center;
  }

  .graph-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 8px;
  }

  .graph-subtitle {
    font-size: 12px;
    color: var(--text-secondary);
  }

  .replay-controls {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin-top: 6px;
  }

  .replay-controls input[type="range"] {
    accent-color: var(--accent-color);
  }

  .replay-meta {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
    font-size: 12px;
    color: var(--text-secondary);
    justify-content: flex-start;
  }

  .replay-meta span {
    background: rgba(255, 255, 255, 0.05);
    padding: 4px 8px;
    border-radius: 8px;
  }

  .replay-marker {
    width: 22px;
    height: 22px;
    border-radius: 50%;
    background: radial-gradient(circle at 30% 30%, #ffe680, #d4a200 70%);
    border: 2px solid rgba(0, 0, 0, 0.6);
    box-shadow: 0 0 12px rgba(255, 215, 0, 0.55);
  }

  .favorites-card {
    text-align: left;
    padding: 16px;
    border: 1px solid rgba(255, 255, 255, 0.05);
    background: rgba(0, 0, 0, 0.25);
  }

  .favorites-search {
    margin-bottom: 12px;
  }

  .favorites-search input {
    width: 100%;
    padding: 8px 10px;
    border-radius: 8px;
    border: 1px solid rgba(255, 255, 255, 0.08);
    background: rgba(255, 255, 255, 0.04);
    color: var(--text-primary);
    font-size: 13px;
  }

  .favorites-section {
    margin-top: 8px;
  }

  .favorites-section-heading {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 8px;
    margin-bottom: 6px;
  }

  .favorites-section-heading h4 {
    margin: 0;
    font-size: 14px;
  }

  .favorites-section-hint {
    font-size: 11px;
    color: var(--text-muted);
  }

  .favorites-privacy-hint {
    margin-top: -4px;
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
  }

  .favorites-link {
    background: none;
    border: none;
    color: var(--accent-color);
    cursor: pointer;
    font-size: 11px;
    text-decoration: underline;
    padding: 0;
  }

  .favorites-link:focus-visible {
    outline: 2px solid var(--accent-color);
    outline-offset: 2px;
  }

  .favorites-divider {
    border: none;
    border-top: 1px solid rgba(255, 255, 255, 0.05);
    margin: 16px 0;
  }

  .cookie-consent-banner {
    position: fixed;
    bottom: 20px;
    right: 20px;
    width: min(360px, calc(100% - 32px));
    z-index: 12;
    background-color: rgba(18, 18, 18, 0.95);
    border-radius: var(--border-radius-lg);
    border: 1px solid rgba(255, 255, 255, 0.08);
    box-shadow: 0 20px 50px rgba(0, 0, 0, 0.7);
    padding: 18px;
    line-height: 1.4;
  }

  .cookie-consent-banner.hidden {
    display: none;
  }

  .cookie-consent-content h4 {
    margin: 0 0 4px 0;
    font-size: 15px;
  }

  .cookie-consent-content p {
    margin: 0 0 10px 0;
    font-size: 13px;
    color: var(--text-secondary);
  }

  .cookie-consent-controls {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 12px;
    flex-wrap: wrap;
  }

  .cookie-consent-controls .consent-toggle {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 13px;
  }

  .cookie-consent-privacy {
    font-size: 12px;
    color: var(--accent-color);
    text-decoration: underline;
    cursor: pointer;
  }

  @media (max-width: 640px) {
    .cookie-consent-banner {
      right: 16px;
      left: 16px;
      width: auto;
    }
  }

  .favorite-user-form {
    margin-bottom: 10px;
  }

  .favorite-user-form input {
    width: 100%;
    padding: 8px 10px;
    border-radius: 8px;
    border: 1px solid rgba(255, 255, 255, 0.08);
    background: rgba(255, 255, 255, 0.04);
    color: var(--text-primary);
    font-size: 13px;
  }

  .favorite-flight-username {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: #000;
    background: var(--accent-color);
    padding: 2px 6px;
    border-radius: 999px;
    margin-bottom: 4px;
  }

  .favorite-friend-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 18px;
    height: 18px;
    border-radius: 999px;
    margin-right: 6px;
    background: rgba(0, 0, 0, 0.2);
    color: var(--accent-color);
    font-size: 10px;
  }

  .favorite-friend-icon i {
    pointer-events: none;
  }

  .favorite-user-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 8px 10px;
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid rgba(255, 255, 255, 0.04);
    border-radius: 10px;
    cursor: pointer;
    transition: border var(--transition-speed), transform var(--transition-speed);
  }

  .favorite-user-item:hover {
    border-color: rgba(255, 195, 0, 0.4);
    transform: translateY(-1px);
  }

  .favorite-user-name {
    font-weight: 600;
    font-size: 14px;
    color: var(--text-primary);
  }

  .favorite-user-item .favorite-remove-button {
    margin-left: auto;
  }

  .favorites-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 12px;
    margin-bottom: 10px;
  }

  .favorites-header h3 {
    margin: 0;
    font-size: 16px;
  }

  .favorites-description {
    font-size: 12px;
    color: var(--text-muted);
    margin-top: 4px;
  }

  .favorites-status {
    font-size: 12px;
    color: var(--accent-color);
    margin-bottom: 8px;
    display: none;
  }

  .favorites-empty {
    font-size: 12px;
    color: var(--text-muted);
    margin: 8px 0;
  }

  .favorites-list {
    display: flex;
    flex-direction: column;
    gap: 10px;
    max-height: 220px;
    overflow-y: auto;
  }

  .favorite-flight-item {
    border-radius: 10px;
    padding: 10px 12px;
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid rgba(255, 255, 255, 0.04);
    display: flex;
    justify-content: space-between;
    align-items: center;
    cursor: pointer;
    transition: border var(--transition-speed), transform var(--transition-speed);
  }

  .favorite-flight-item.live {
    border-color: rgba(34, 197, 94, 0.4);
  }

  .favorite-flight-item:hover {
    border-color: rgba(255, 195, 0, 0.4);
    transform: translateY(-1px);
  }

  .favorite-flight-info {
    flex: 1;
  }

  .favorite-flight-title {
    font-weight: 600;
    font-size: 14px;
    margin-bottom: 4px;
  }

  .favorite-flight-route {
    font-size: 12px;
    color: var(--text-muted);
  }

  .favorite-flight-meta {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .favorite-flight-tag {
    font-size: 11px;
    padding: 2px 8px;
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.08);
    text-transform: uppercase;
  }

  .favorite-remove-button {
    background: transparent;
    border: none;
    color: var(--text-secondary);
    cursor: pointer;
    font-size: 14px;
    padding: 2px 4px;
    border-radius: 4px;
    transition: background var(--transition-speed);
  }

  .favorite-remove-button:hover {
    background: rgba(255, 255, 255, 0.1);
    color: var(--text-primary);
  }

  .container > div:hover {
    transform: translateY(-2px);
  }

  .container > div span {
    display: block;
    font-size: 14px;
    color: var(--text-secondary);
    margin-bottom: 4px;
  }

  .container > div h2 {
    margin: 5px 0;
    font-size: 18px;
    font-weight: 500;
  }

  .full-width {
    grid-column: span 2;
    max-width: 100%;
  }

  .wrapper {
    width: 80%;
  }

  /* Progress Bar */
  .progress-bar {
    width: 80%;
    margin: auto;
    height: 0.8em;
    background: var(--tertiary-bg);
    padding: 1%;
    border-radius: 50px;
    position: relative;
    overflow: hidden;
  }

  .flight-header {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 2px;

      }

      .flight-actions {
          margin-left: auto;
          display: inline-flex;
          align-items: center;
          gap: 8px;
      }

      .flight-number {
          font-weight: 600;
          font-size: 16px;
          color: var(--text-primary);
          margin-right: 20px;
      }

      .aircraft-type {
          font-size: 12px;
          color: var(--text-muted);
          background: var(--border-color);
          padding: 2px 8px;
          border-radius: 4px;
          margin-right: 20px;
      }

      .status-badge {
          font-size: 11px;
          font-weight: 600;
          padding: 4px 8px;
          border-radius: 4px;
          text-transform: uppercase;
          letter-spacing: 0.5px;
      }

      .focus-toggle-button {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
          padding: 6px 12px;
          border-radius: 6px;
          background: var(--tertiary-bg);
          border: 1px solid var(--border-color);
          color: var(--text-secondary);
          font-size: 12px;
          font-weight: 500;
          cursor: pointer;
          transition: background var(--transition-speed), color var(--transition-speed), border-color var(--transition-speed), box-shadow var(--transition-speed);
      }

      .focus-toggle-button:hover,
      .focus-toggle-button:focus-visible {
          background: var(--accent-hover);
          border-color: var(--accent-hover);
          color: #000;
          outline: none;
      }

      .focus-toggle-button.active {
          background: var(--accent-color);
          border-color: var(--accent-color);
          color: #000;
          box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.2);
      }

      .favorite-toggle-button {
          background: rgba(255, 255, 255, 0.05);
      }

      .favorite-toggle-button.active {
          background: var(--accent-color);
          border-color: var(--accent-color);
          color: #000;
      }

      .favorite-toggle-button:disabled {
          opacity: 0.5;
          cursor: not-allowed;
      }

      .flight-route {
          padding: 20px;
      }

      .route-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
      }

      .airport {
          flex: 1;
          transition: opacity 0.3s ease;
      }

      .airport.faded {
          opacity: 0.2;
      }

      .airport-main {
          display: flex;
          align-items: baseline;
          gap: 8px;
      }

      .airport-code {
          font-size: 24px;
          font-weight: 700;
          color: var(--text-primary);
      }

      .airport-name {
          font-size: 12px;
          color: var(--text-muted);
          font-weight: 500;
      }

      .time-info {
          display: flex;
          flex-direction: column;
          gap: 2px;
      }

      .scheduled-time {
          font-size: 14px;
          color: var(--text-secondary);
          font-weight: 500;
      }

      .actual-time {
          font-size: 11px;
          color: var(--text-muted);
      }

      .actual-time.delayed {
          color: var(--diversion-color);
      }

      .actual-time.early {
          color: var(--success-color);
      }

      .route-center {
          text-align: center;
          flex: 1;
          margin: 0 30px;
      }

      .flight-duration {
          font-size: 12px;
          color: var(--text-muted);
      }

      .diversion-notice {
          background: var(--warning-bg);
          border: 1px solid var(--diversion-color);
          border-radius: 6px;
          padding: 12px;
          margin-bottom: 15px;
          display: none;
      }

      .diversion-notice.show {
          display: block;
      }

      .diversion-title {
          font-size: 12px;
          font-weight: 600;
          color: var(--diversion-color);
          margin-bottom: 4px;
          text-transform: uppercase;
          letter-spacing: 0.5px;
      }

      .diversion-info {
          display: flex;
          justify-content: space-between;
          align-items: center;
      }

      .diversion-airport {
          display: flex;
          align-items: baseline;
          gap: 8px;
      }

      .diversion-code {
          font-size: 18px;
          font-weight: 700;
          color: var(--diversion-color);
          font-family: 'SF Mono', Monaco, 'Cascadia Code', monospace;
      }

      .diversion-name {
          font-size: 11px;
          color: var(--text-secondary);
      }

      .diversion-time {
          font-size: 11px;
          color: var(--text-secondary);
      }

      .progress-section {
          position: relative;
          height: 30px;
          margin: 20px 0;
          margin-top: -20px;
      }

      .progress-track {
          position: absolute;
          top: 50%;
          left: 0;
          right: 0;
          height: 2px;
          background: var(--flight-path);
          transform: translateY(-50%);
      }

      .progress-fill {
          height: 100%;
          background: var(--completed-path);
          transition: width 1.2s cubic-bezier(0.4, 0, 0.2, 1);
          position: relative;
      }

      .progress-fill.diverted {
          background: linear-gradient(90deg, var(--completed-path) 0%, var(--completed-path) 70%, var(--diversion-color) 100%);
      }

      .aircraft-icon {
          position: absolute;
          top: 50%;
          transform: translate(-50%, -50%);
          width: 16px;
          height: 16px;
          background: var(--text-primary);
          transition: left 1.2s cubic-bezier(0.4, 0, 0.2, 1);
          clip-path: polygon(
                        100% 50%,  /* rotated tip */
                        0% 0%,     /* rotated bottom-left */
                        15% 20%,   /* rotated inner-left */
                        10% 50%,   /* rotated base center */
                        15% 80%,   /* rotated inner-right */
                        0% 100%    /* rotated bottom-right */
                      );
      }

      .aircraft-icon.diverted {
          background: var(--diversion-color);
      }

      .route-points {
          position: absolute;
          top: 50%;
          left: 0;
          right: 0;
          transform: translateY(-50%);
          display: flex;
          justify-content: space-between;
          pointer-events: none;
      }

      .route-point {
          width: 10px;
          height: 10px;
          border-radius: 50%;
          background: var(--text-muted);
          border: 2px solid var(--secondary-bg);
      }

      .route-point.active {
          background: var(--completed-path);
      }

      .route-point.diversion {
          background: var(--diversion-color);
      }

      .progress-info {
          display: grid;
          grid-template-columns: 1fr auto 1fr;
          align-items: center;
          margin-top: 5px;
          font-size: 11px;
          color: var(--text-muted);
          gap: 10px;
      }

      .progress-left {
          text-align: left;
      }

      .progress-center {
          text-align: center;
      }

      .progress-text {
          font-weight: 500;
          color: var(--text-secondary);
          font-size: 12px;
      }

      .progress-right {
          text-align: right;
      }

  hr {
    height: 2px;
    background-color: var(--accent-color);
    border: none;
    margin: 12px 0;
  }

  /* Sidebar Navigation */
  .sidenav {
    height: 20%;
    width: 30%;
    position: fixed;
    border-radius: var(--border-radius-lg);
    z-index: 2;
    top: 10%;
    left: 69%;
    display: none;
    transition: all var(--transition-speed) ease;
    overflow-y: auto;
    min-height: 85%;
    background-color: rgba(30, 30, 30, 0.85);
    border: 1px solid rgba(255, 255, 255, 0.1);
  }

  @media (max-width: 850px) {
    .sidenav {
      height: 20%;
      width: 100%;
      position: fixed;
      border-radius: var(--border-radius-lg) var(--border-radius-lg) 0 0;
      z-index: 10;
      left: 0;
      bottom: 0;
      top: auto;
      display: none;
      transition: all var(--transition-speed) ease;
      overflow-y: auto;
      background-color: rgba(30, 30, 30, 0.9);
    }
  }

  .sidenav.expanded {
    height: 50%;
  }

  .sidenav a {
    padding: 0px 0px 0px 10px;
    text-decoration: none;
    font-size: 15px;
    color: var(--text-primary);
    transition: var(--transition-speed);
  }

  .sidenav a:hover {
    color: var(--accent-color);
  }

  #MapContainer {
    transition: margin-left .5s;
    position: absolute;
    top: 0;
    z-index: 1;
    right: 0;
    bottom: 0;
    left: 0;
  }

  /* Map Controls */
  .leaflet-control-zoom {
    background-color: var(--secondary-bg);
    border-radius: var(--border-radius-sm);
    overflow: hidden;
  }

  .leaflet-control-zoom a {
    background: var(--tertiary-bg);
    color: var(--text-primary);
    border: none !important;
    transition: background-color var(--transition-speed);
  }

  .leaflet-control-zoom a:hover {
    background: var(--card-bg);
  }

  @media screen and (max-height: 500px) {
    .sidenav {padding-top: 0px;}
    .sidenav a {font-size: 18px;}
  }

  .wrapper {
    width: 100%;
  }

  /* Profile Card */
  .profile-card {
    width: 100%;
    max-width: 500px;
    background-color: var(--card-bg);
    border-radius: var(--border-radius-lg);
    overflow: hidden;
    outline-color: white;
  }

  .profile-header {
    text-align: center;
    margin-bottom: 18px;
    padding: 20px;
  }

  .profile-header h2, .profile-header h3 {
    margin: 0;
    font-size: 18px;
    color: var(--accent-color);
    font-weight: 600;
  }

  .profile-content {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 16px;
    padding: 0 8px 8px;
  }

  .profile-content .section {
    background-color: var(--secondary-bg);
    padding: 4px;
    border-radius: var(--border-radius-md);
    text-align: center;
    transition: transform var(--transition-speed);
  }

  .profile-content .section:hover {
    transform: translateY(-2px);
  }

  .section h3 {
    margin: 0;
    font-size: 16px;
    color: var(--accent-color);
    font-weight: 500;
  }

  .section p {
    margin: 10px 0 0;
    font-size: 22px;
    color: var(--text-primary);
    font-weight: 600;
  }

  /* Header */
  header {
    position: fixed;
    top: 2%;
    width: 100%;
    border-radius: var(--border-radius-md);
    display: flex;
    justify-content: space-between;
    align-items: center;
    background-color: rgba(37, 37, 37, 0.85);
    padding: 6px 8px;
    z-index: 1000;
    border: 1px solid rgba(255, 255, 255, 0.05);
  }

  /* Search Bar */
  .search-bar {
    position: relative;
    display: flex;
    align-items: center;
    background-color: var(--tertiary-bg);
    padding: 4px 6px;
    border-radius: var(--border-radius-md);
    width: 75%;
    transition: all var(--transition-speed);
    border: 1px solid rgba(255, 255, 255, 0.05);
  }

  .search-bar:focus-within {
    box-shadow: 0 0 0 2px rgba(255, 195, 0, 0.3);
  }

  .search-bar input {
    background: none;
    border: none;
    color: var(--text-primary);
    font-size: 14px;
    outline: none;
    width: 100%;
    font-family: inherit;
  }

  .search-bar input::placeholder {
    color: var(--text-tertiary);
  }

  .search-bar .icon {
    margin-right: 10px;
    color: var(--text-secondary);
    display: inline;
  }

  /* Search Results Dropdown */
  .search-results {
    display: none;
    position: absolute;
    top: 100%;
    left: 0;
    width: 100%;
    background-color: var(--secondary-bg);
    z-index: 1;
    border-radius: 0 0 var(--border-radius-md) var(--border-radius-md);
    max-height: 300px;
    font-size: 14px;
    overflow-y: auto;
    border: 1px solid rgba(255, 255, 255, 0.05);
    margin-top: 4px;
  }

  .search-results a {
    color: var(--text-primary);
    padding: 12px 16px;
    text-decoration: none;
    display: block;
    transition: background-color var(--transition-speed);
  }

  .search-results a:hover {
    background-color: var(--tertiary-bg);
  }

  /* Dropdown Menu */
  .dropdown {
    position: relative;
    display: inline-block;
  }

  .dropdown button {
    background-color: var(--tertiary-bg);
    color: var(--text-primary);
    border-radius: var(--border-radius-md);
    padding: 4px 6px;
    border: 1px solid rgba(255, 255, 255, 0.05);
    font-size: 14px;
    cursor: pointer;
    transition: background-color var(--transition-speed);
    font-family: inherit;
    font-weight: 500;
  }

  .dropdown button:hover {
    background-color: var(--card-bg);
  }

  .dropdown-content {
    display: none;
    position: absolute;
    background-color: var(--secondary-bg);
    min-width: 180px;
    font-size: 14px;
    z-index: 1;
    border-radius: var(--border-radius-md);
    overflow: hidden;
    border: 1px solid rgba(255, 255, 255, 0.05);
    margin-top: 4px;
  }

  .dropdown-content a {
    color: var(--text-primary);
    padding: 12px 16px;
    text-decoration: none;
    display: block;
    cursor: pointer;
    transition: background-color var(--transition-speed);
  }

  .dropdown-content a:hover {
    background-color: var(--tertiary-bg);
  }

  .dropdown:hover .dropdown-content {
    display: block;
  }

  /* Profile Button */
  #profile-button {
    position: fixed;
    bottom: 30px;
    left: 20px;
    background-color: #333;
    border-radius: 50%;
    width: 35px;
    height: 35px;
    display: flex;
    justify-content: center;
    align-items: center;
    font-size: 20px;
    color: var(--primary-bg);
    z-index: 3;
    cursor: pointer;
    transition: transform var(--transition-speed), background-color var(--transition-speed);
  }

  #profile-button:hover {
    background-color: var(--accent-hover);
    transform: scale(1.05);
  }

  #favorites-button {
    position: fixed;
    bottom: 30px;
    left: 70px;
    background-color: #333;
    border-radius: 50%;
    width: 35px;
    height: 35px;
    display: flex;
    justify-content: center;
    align-items: center;
    font-size: 18px;
    color: var(--primary-bg);
    z-index: 3;
    cursor: pointer;
    transition: transform var(--transition-speed), background-color var(--transition-speed);
  }

  #favorites-button:hover,
  #favorites-button.active {
    background-color: var(--accent-color);
    color: var(--primary-bg);
    transform: scale(1.05);
  }

  .favorites-popup {
    position: fixed;
    bottom: 80px;
    left: 20px;
    width: min(340px, calc(100% - 40px));
    z-index: 4;
    background-color: rgba(18, 18, 18, 0.95);
    border-radius: var(--border-radius-lg);
    border: 1px solid rgba(255, 255, 255, 0.05);
    box-shadow: 0 20px 50px rgba(0, 0, 0, 0.6);
    backdrop-filter: blur(6px);
  }

  .favorites-popup.hidden {
    display: none;
  }

  /* Sign In Popup */
  #sign-in-popup {
    position: fixed;
    top: 50%;
    z-index: 11;
    left: 50%;
    transform: translate(-50%, -50%);
    background-color: var(--secondary-bg);
    padding: 24px;
    border-radius: var(--border-radius-lg);
    display: none;
    flex-direction: column;
    align-items: center;
    border: 1px solid rgba(255, 255, 255, 0.05);
    max-width: 90%;
    width: 400px;
  }

  .hidden {
    display: none;
  }

  .g_id_signin {
    margin-top: 16px;
  }

  /* Subscription Badge */
  .subscription-badge {
    display: inline-block;
    padding: 5px 10px;
    background-color: rgba(255, 158, 40, 0.15);
    color: var(--accent-color);
    font-size: 0.8rem;
    border-radius: var(--border-radius-md);
    margin-left: -70px;
    font-weight: 600;
    text-transform: uppercase;
    vertical-align: middle;
    animation: glowing 1.5s infinite alternate;
  }

  @keyframes glowing {
    from {
      box-shadow: 0 0 10px rgba(228, 113, 46, 0.3), 0 0 20px rgba(228, 113, 46, 0.1);
    }
    to {
      box-shadow: 0 0 15px rgba(228, 113, 46, 0.5), 0 0 25px rgba(228, 113, 46, 0.2);
    }
  }

  /* Overlay Text */
  .overlay-text {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    color: var(--text-primary);
    font-size: 24px;
    font-weight: 600;
    text-align: center;
    background-color: rgba(0, 0, 0, 0.7);
    padding: 16px 24px;
    border-radius: var(--border-radius-md);
  }

  /* Popup Overlay */
  .popup-overlay {
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: rgba(0, 0, 0, 0.8);
    display: flex;
    align-items: center;
    justify-content: center;
    visibility: hidden;
    opacity: 0;
    transition: opacity var(--transition-speed) ease, visibility var(--transition-speed);
    z-index: 99999;
  }

  /* Popup Container */
  .popup {
    background-color: var(--secondary-bg);
    padding: 32px;
    border-radius: var(--border-radius-lg);
    max-width: 90%;
    width: 400px;
    text-align: center;
    transform: scale(0.9);
    transition: transform var(--transition-speed);
    border: 1px solid rgba(255, 255, 255, 0.05);
  }

  /* Message Text */
  .popup h2 {
    margin-top: 0;
    color: var(--accent-color);
    font-size: 24px;
    font-weight: 600;
    margin-bottom: 16px;
  }

  .popup p {
    margin-bottom: 24px;
    line-height: 1.6;
    color: var(--text-secondary);
  }

  /* Button Styling */
  .popup button {
    margin-top: 8px;
    padding: 10px 24px;
    border: none;
    border-radius: var(--border-radius-md);
    background-color: var(--accent-color);
    color: var(--primary-bg);
    font-size: 16px;
    font-weight: 500;
    cursor: pointer;
    transition: background-color var(--transition-speed), transform var(--transition-speed);
    font-family: inherit;
  }

  .popup button:hover {
    background-color: var(--accent-hover);
    transform: translateY(-2px);
  }

  .popup button:active {
    transform: translateY(0);
  }

  /* Show Popup */
  .popup-overlay.active {
    visibility: visible;
    opacity: 1;
  }

  .popup-overlay.active .popup {
    transform: scale(1);
  }

  /* Image Container */
  .image-container {
    position: relative;
    display: inline-block;
    overflow: hidden;
    border-radius: 8px;
    width: 100%;
}

.image-container img {
    display: block;
    width: 100%;
    height: auto;
    z-index: -1;
}

/* Removed hover transform for performance */

.image-container .credits {
    position: absolute;
    bottom: 12px;
    left: 12px;
    color: white;
    background-color: rgba(0, 0, 0, 0.7);
    padding: 6px 12px;
    font-size: 12px;
    border-radius: 4px;
    white-space: nowrap;
    /* Removed backdrop-filter for iOS performance */
}

/* Toggle Switch - Simplified */
#switch-container {
    display: flex;
    align-items: center;
    background: #333;
    width: fit-content;
    padding: 8px 12px;
    border-radius: 8px;
    margin-top: 8px;
    font-size: 12px;
    border: 1px solid #444;
}

.label {
    font-size: 12px;
    margin: 0 8px;
    color: #ccc;
}

.switch {
    position: relative;
    display: inline-block;
    width: 50px;
    height: 24px;
}

.switch input {
    display: none;
}

.slider {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background-color: #555;
    border-radius: 34px;
    cursor: pointer;
    transition: background-color 0.2s;
    border: 1px solid #666;
}

.slider:before {
    position: absolute;
    content: '';
    height: 18px;
    width: 18px;
    left: 3px;
    bottom: 2px;
    background-color: white;
    border-radius: 50%;
    transition: transform 0.2s;
}

input:checked + .slider {
    background-color: #4CAF50;
}

input:checked + .slider:before {
    transform: translateX(26px);
}

/* Flight List - Simplified */
.flight-list {
    display: flex;
    flex-direction: column;
    gap: 16px;
}

.flight-item {
    background-color: #222;
    border-radius: 8px;
    overflow: hidden;
    border: 1px solid #333;
}

/* Removed hover effects for performance */

.flight-summary {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 16px 20px;
    cursor: pointer;
}

.status-circle {
    width: 12px;
    height: 12px;
    border-radius: 50%;
}

.status-circle.green {
    background-color: #4CAF50;
}

.status-circle.orange {
    background-color: #FF9800;
}

.flight-info {
    flex: 1;
    margin-left: 16px;
}

.flight-info span {
    display: block;
}

.flight-name {
    font-size: 1rem;
    font-weight: 600;
    color: #fff;
}

.flight-origin {
    font-size: 0.9rem;
    color: #ccc;
    margin-top: 4px;
}

.flight-eta {
    font-size: 0.9rem;
    color: #ccc;
    margin-top: 2px;
}

.arrow {
    font-size: 1.2rem;
    color: #ccc;
    transition: transform 0.2s ease;
}

.flight-item.expanded .arrow {
    transform: rotate(180deg);
}

/* Flight Details - Simplified */
.flight-details {
    padding: 16px 20px;
    border-top: 1px solid #333;
    display: block;
}

.aircraft-image {
    float: left;
    width: 120px;
    height: 70px;
    border-radius: 4px;
    object-fit: cover;
    background-color: #333;
    margin-right: 16px;
}

.details-info {
    display: block;
}

.details-info div {
    margin-bottom: 8px;
    font-size: 0.9rem;
    color: #ccc;
}

.details-info strong {
    font-weight: 600;
    color: #fff;
}

.fly-button {
    display: block;
    float: right;
    margin-top: -20px;
    background-color: #2196F3;
    color: white;
    border: none;
    padding: 8px 16px;
    border-radius: 8px;
    font-size: 0.9rem;
    font-weight: 500;
    cursor: pointer;
}

.add-flight-button {
    display: block;
    margin: 20px auto 0;
    background-color: #2196F3;
    color: white;
    border: none;
    padding: 12px 24px;
    border-radius: 8px;
    font-size: 1rem;
    font-weight: 500;
    cursor: pointer;
}

/* Simplified glowing box icon */
.glowing-box-icon {
    position: relative;
    width: 60px;
    height: 60px;
    display: flex;
    justify-content: center;
    align-items: center;
    background: linear-gradient(135deg, #00c6ff, #0072ff);
    border-radius: 12px;
    overflow: hidden;
}

.glowing-box-icon span {
    position: relative;
    z-index: 2;
    color: #fff;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    font-size: 18px;
    font-weight: 600;
}

/* Removed pulse animation for performance */

/* Responsive Design */
@media (max-width: 700px) {
    header {
        width: 100%;
        left: 0%;
        top: 0%;
        background-color: rgba(18, 18, 18, 0.95);
        border-radius: 0px;
        padding: 12px 16px;
    }
    .search-bar {
        width: 55%;
    }
}

@media (min-width: 800px) {
    header {
        width: 50%;
        left: 49%;
        right: auto;
    }
    .sidenav {
        width: 50%;
        left: 49%;
        right: auto;
    }
}

@media (min-width: 1000px) {
    header {
        width: 30%;
        left: 69%;
        right: auto;
    }
    .sidenav {
        width: 30%;
        left: 69%;
        right: auto;
    }
}

@media (max-width: 500px) {
    .profile-content {
        grid-template-columns: 1fr;
    }
    .container {
        padding: 12px;
        gap: 12px;
    }
    .container > div {
        padding: 12px;
    }
    .popup {
        padding: 24px;
    }
}

/* Simplified Globe Box */
#globebox {
    margin: 0px;
    background: linear-gradient(135deg, #36669c, #41a0ae, #3ec995, #77f07f);
    padding: 8px;
    border-radius: 8px;
    font-size: 12px;
}

#globetext {
    font-weight: 600;
    color: white;
}

/* Links */
a {
    color: #2196F3;
    text-decoration: none;
}

.circle-button {
    background-color: gray;
    color: white;
    border: none;
    border-radius: 50%;
    width: 30px;
    height: 30px;
    font-size: 10px;
    font-weight: bold;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    float: right;
}

#favorite-user-button {
    background-color: rgba(255, 255, 255, 0.1);
    color: var(--accent-color);
}

#favorite-user-button.active {
    background-color: var(--accent-color);
    color: #000;
}

/* Simplified fire glow effect */
.fire-glow {
    border: 2px solid #ff6a00;
    background: #111;
    color: white;
    text-align: center;
}

.airportpage-widget {
    color: #f0f6fc;
    padding: 1.8rem 2rem;
    width: 320px;
    border-radius: 12px;
    background: #1a1a1a;
    border: 1px solid #333;
    display: flex;
    flex-direction: column;
    gap: 1.2rem;
}

.airportpage-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-end;
}

.airportpage-name {
    font-size: 1.4rem;
    font-weight: 600;
}

.airportpage-code {
    font-size: 1rem;
    opacity: 0.65;
}

.airportpage-stats {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
}

.airportpage-stat-row {
    display: flex;
    justify-content: space-between;
    font-size: 0.95rem;
}

.airportpage-delay {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
}

.airportpage-bar {
    height: 10px;
    background-color: #30363d;
    border-radius: 4px;
    overflow: hidden;
}

.airportpage-bar-fill {
    height: 100%;
    transition: width 0.3s ease;
}

.airportpage-status-green { background-color: #238636; }
.airportpage-status-orange { background-color: #e3b341; }
.airportpage-status-red { background-color: #da3633; }

.airportpage-footer {
    font-size: 0.75rem;
    color: #8b949e;
    text-align: center;
}

.atis-container {
    background: rgba(30, 30, 50, 0.95);
    border-radius: 20px;
    padding: 30px;
    border: 1px solid rgba(255, 255, 255, 0.1);
    max-width: 600px;
    width: 100%;
}

.header {
    text-align: center;
    margin-bottom: 30px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.1);
    padding-bottom: 20px;
}

.airport-code {
    font-size: 2.5rem;
    font-weight: 700;
    color: #4fd1c7;
    margin-bottom: 5px;
}

.info-label {
    color: #888;
    font-size: 0.9rem;
    display: flex;
    align-items: center;
    gap: 10px;
}

.info-bravo {
    background: linear-gradient(45deg, #ff6b6b, #ee5a24);
    color: white;
    padding: 4px 12px;
    border-radius: 15px;
    font-size: 0.8rem;
    font-weight: 600;
}

.data-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 20px;
    margin-bottom: 30px;
}

.data-card {
    background: rgba(255, 255, 255, 0.05);
    border-radius: 15px;
    padding: 20px;
    border: 1px solid rgba(255, 255, 255, 0.1);
}

.card-title {
    color: #FFC300;
    font-size: 0.85rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 1px;
    margin-bottom: 10px;
}

.card-value {
    font-size: 1rem;
    font-weight: 700;
    color: #fff;
    margin-bottom: 5px;
}

.card-unit {
    color: #888;
    font-size: 0.9rem;
}

.runway-section {
    border-radius: 15px;
    padding: 20px;
    border: 1px solid rgba(255, 255, 255, 0.1);
}

.runway-title {
    color: #FFFFFF;
    font-size: 1.1rem;
    font-weight: 600;
    margin-bottom: 5px;
    text-align: center;
}

.runway-info {
    display: flex;
    justify-content: space-around;
    text-align: center;
}

.runway-type {
    flex: 1;
}

.runway-type h4 {
    color: #666;
    font-size: 0.9rem;
    margin-bottom: 8px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
}

.runway-numbers {
    font-size: 1.3rem;
    font-weight: 700;
    color: #fff;
    display: flex;
    flex-direction: column;
    gap: 5px;
}

.runway-item.runway-green {
    color: #28a745;
}

.runway-item.runway-yellow {
    color: #ffc107;
}

.runway-item.runway-red {
    color: #dc3545;
}

.runway-legend {
    margin-top: 15px;
    font-size: 0.75rem;
    color: #888;
    text-align: center;
    display: flex;
    justify-content: center;
    gap: 15px;
    flex-wrap: wrap;
}

.legend-item {
    display: flex;
    align-items: center;
    gap: 5px;
}

.legend-color {
    width: 8px;
    height: 8px;
    border-radius: 50%;
}

.legend-green { background-color: #28a745; }
.legend-yellow { background-color: #ffc107; }
.legend-red { background-color: #dc3545; }

.time-display {
    text-align: center;
    margin-top: 20px;
    padding-top: 20px;
    border-top: 1px solid rgba(255, 255, 255, 0.1);
    color: #888;
    font-size: 0.9rem;
}

.flight-history-section {
    position: relative;
    margin-bottom: 25px;
}

.flight-history-toggle-button {
    background: #222;
    color: #FFFFFF;
    border: none;
    padding: 16px 25px;
    width: 100%;
    text-align: left;
    border-radius: 12px;
    cursor: pointer;
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 1.1rem;
    font-weight: 600;
    transition: background-color 0.2s ease;
}

.flight-history-toggle-button:hover {
    background: #333;
}

.flight-history-toggle-button i {
    transition: transform 0.3s ease;
    font-size: 1rem;
}

.flight-history-flights-container {
    background: #111;
    border-radius: 0 0 12px 12px;
    overflow: hidden;
    max-height: 0;
    opacity: 0;
    transition: all 0.3s ease;
    margin-top: 8px;
}

.flight-history-flights-container.flight-history-visible {
    max-height: 1000px;
    opacity: 1;
}

.flight-history-flight-list {
    padding: 8px 0;
}

.flight-history-flight-item {
    padding: 14px 20px;
    border-bottom: 1px solid #333;
}

.flight-history-flight-item:last-child {
    border-bottom: none;
}

.flight-history-flight-header {
    display: flex;
    justify-content: space-between;
    margin-bottom: 8px;
    align-items: center;
}

.flight-history-flight-name {
    font-weight: 700;
    color: #999;
    font-size: 16px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 200px;
}

.flight-history-flight-date {
    color: #FFC300;
    font-size: 13px;
    flex-shrink: 0;
    margin-left: 10px;
}

.flight-history-flight-info {
    display: flex;
    justify-content: space-between;
    font-size: 14px;
}

.flight-history-route {
    color: #e0e1dd;
    font-weight: 500;
}

.flight-history-times {
    display: flex;
    gap: 15px;
}

.flight-history-time-block {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
}

.flight-history-time-label {
    color: #999;
    font-size: 11px;
    text-transform: uppercase;
}

.flight-history-time-value {
    font-weight: 600;
    color: #e0e1dd;
    font-size: 13px;
    margin-top: 3px;
}

.flight-history-loading {
    padding: 20px;
    text-align: center;
    color: #90e0ef;
}

.flight-history-loading i {
    margin-bottom: 10px;
    font-size: 24px;
}

/* Simplified rotation animation */
@keyframes flight-history-spin {
    0% { transform: rotate(0deg); }
    100% { transform: rotate(360deg); }
}

.filter-container {
    position: absolute;
    top: 20px;
    left: 15px;
    z-index: 1000;
}

.filter-button {
    background: rgba(20, 20, 20, 0.95);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 12px;
    padding: 5px 12px;
    color: #ffffff;
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 12px;
    font-weight: 500;
    transition: background-color 0.2s ease;
}

.filter-button:hover {
    background: rgba(30, 30, 30, 0.95);
    border-color: rgba(255, 255, 255, 0.2);
}

.filter-panel {
    position: absolute;
    top: 60px;
    left: 0;
    width: min(400px, 90vw);
    background: rgba(15, 15, 15, 0.95);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 16px;
    padding: 20px;
    transform: translateY(-10px);
    opacity: 0;
    visibility: hidden;
    transition: all 0.2s ease;
}

.filter-panel.active {
    transform: translateY(0);
    opacity: 1;
    visibility: visible;
}

.search-input {
    width: 100%;
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 10px;
    padding: 12px 16px;
    color: #ffffff;
    font-size: 14px;
    outline: none;
    transition: border-color 0.2s ease;
    margin-bottom: 16px;
}

.search-input:focus {
    border-color: #3b82f6;
    background: rgba(255, 255, 255, 0.08);
}

.search-input::placeholder {
    color: rgba(255, 255, 255, 0.5);
}

.filter-tags {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-bottom: 16px;
    min-height: 20px;
}

.filter-tag {
    background: rgba(255, 195, 0, 0.2);
    border: 1px solid rgba(255, 195, 0, 0.3);
    border-radius: 20px;
    padding: 6px 12px;
    font-size: 12px;
    color: #FFFFFF;
    display: flex;
    align-items: center;
    gap: 6px;
}

.filter-tag .remove {
    cursor: pointer;
    opacity: 0.7;
    transition: opacity 0.2s ease;
}

.filter-tag .remove:hover {
    opacity: 1;
}

.suggestions {
    background: rgba(20, 20, 20, 0.95);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 8px;
    margin-top: 8px;
    max-height: 250px;
    overflow-y: auto;
    display: none;
}

.suggestions.active {
    display: block;
}

.suggestion-item {
    padding: 12px 14px;
    cursor: pointer;
    font-size: 13px;
    transition: background-color 0.2s ease;
    border-bottom: 1px solid rgba(255, 255, 255, 0.05);
    display: flex;
    align-items: center;
    justify-content: space-between;
}

.suggestion-item:last-child {
    border-bottom: none;
}

.suggestion-item:hover {
    background: rgba(255, 255, 255, 0.08);
}

.suggestion-item.selected {
    background: rgba(59, 130, 246, 0.2);
}

.suggestion-content {
    flex: 1;
}

.suggestion-title {
    color: #ffffff;
    font-weight: 500;
}

.suggestion-detail {
    color: rgba(255, 255, 255, 0.6);
    font-size: 11px;
    margin-top: 2px;
}

.suggestion-type {
    background: rgba(255, 195, 0, 0.2);
    color: #FFFFFF;
    padding: 2px 6px;
    border-radius: 4px;
    font-size: 10px;
    text-transform: uppercase;
    font-weight: 600;
}

.keyword-highlight {
    background: rgba(255, 195, 0, 0.3);
    color: #FFFFFF;
    padding: 1px 3px;
    border-radius: 3px;
    font-weight: 600;
}

.input-container {
    position: relative;
}

.filter-actions {
    display: flex;
    gap: 8px;
    margin-top: 16px;
}

.btn {
    padding: 8px 16px;
    border-radius: 8px;
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    transition: background-color 0.2s ease;
    border: none;
}

.btn-primary {
    background: #FFC300;
    color: white;
}

.btn-primary:hover {
    background: #e6b000;
}

.btn-secondary {
    background: rgba(255, 255, 255, 0.1);
    color: #ffffff;
}

.btn-secondary:hover {
    background: rgba(255, 255, 255, 0.15);
}

.filter-icon {
    width: 16px;
    height: 16px;
    fill: currentColor;
}

.status-text {
    font-size: 12px;
    color: rgba(255, 255, 255, 0.6);
    margin-top: 12px;
}

.waypoints-widget {
           border-radius: 8px;
           overflow: hidden;
           color: #e0e0e0;
           font-size: 14px;
       }

       .toggle-header {
           padding: 3px 4px;
           cursor: pointer;
           display: flex;
           align-items: center;
           justify-content: between;
           transition: all 0.2s ease;
           user-select: none;
       }

       .toggle-header:hover {
           background: linear-gradient(135deg, #2563eb 0%, #3b82f6 100%);
       }

       .toggle-title {
           font-weight: 600;
           display: flex;
           align-items: center;
           gap: 8px;
           flex: 1;
       }

       .toggle-icon {
           font-size: 12px;
           color: rgba(255, 255, 255, 0.8);
       }

       .stats-mini {
           display: flex;
           gap: 5px;
           font-size: 10px;
           opacity: 0.9;
       }

       .chevron {
           transition: transform 0.2s ease;
           font-size: 12px;
           margin-left: 8px;
       }

       .waypoints-widget.collapsed .chevron {
           transform: rotate(-90deg);
       }

       .content {
           display: none;
           max-height: 300px;
           overflow-y: auto;
           background: rgba(15, 15, 15, 0.8);
       }

       .waypoints-widget:not(.collapsed) .content {
           display: block;
           animation: slideDown 0.3s ease;
       }

       @keyframes slideDown {
           from {
               opacity: 0;
               max-height: 0;
           }
           to {
               opacity: 1;
               max-height: 300px;
           }
       }

       .content::-webkit-scrollbar {
           width: 4px;
       }

       .content::-webkit-scrollbar-track {
           background: rgba(255, 255, 255, 0.05);
       }

       .content::-webkit-scrollbar-thumb {
           background: rgba(255, 255, 255, 0.2);
           border-radius: 2px;
       }

       .procedure-group {
           border-bottom: 1px solid rgba(255, 255, 255, 0.05);
       }

       .procedure-group:last-child {
           border-bottom: none;
       }

       .procedure-header {
           padding: 8px 12px;
           background: rgba(59, 130, 246, 0.08);
           cursor: pointer;
           transition: background 0.2s ease;
           display: flex;
           align-items: center;
           justify-content: space-between;
           font-size: 12px;
           border-bottom: 1px solid rgba(59, 130, 246, 0.1);
       }

       .procedure-header:hover {
           background: rgba(59, 130, 246, 0.12);
       }

       .procedure-title {
           font-weight: 500;
           color: #93c5fd;
           display: flex;
           align-items: center;
           gap: 6px;
       }

       .procedure-count {
           background: #2563eb;
           color: white;
           border-radius: 10px;
           padding: 2px 6px;
           font-size: 10px;
           font-weight: 600;
           min-width: 16px;
           text-align: center;
       }

       .procedure-chevron {
           font-size: 10px;
           transition: transform 0.2s ease;
           color: #60a5fa;
       }

       .procedure-group.collapsed .procedure-chevron {
           transform: rotate(-90deg);
       }

       .waypoints {
           display: none;
       }

       .procedure-group:not(.collapsed) .waypoints {
           display: block;
       }

       .waypoint {
           padding: 8px 12px 8px 20px;
           cursor: pointer;
           transition: all 0.2s ease;
           border-bottom: 1px solid rgba(255, 255, 255, 0.03);
           position: relative;
       }

       .waypoint:last-child {
           border-bottom: none;
       }

       .waypoint:hover {
           background: rgba(255, 255, 255, 0.03);
           padding-left: 24px;
       }

       .waypoint::before {
           content: '';
           position: absolute;
           left: 8px;
           top: 50%;
           transform: translateY(-50%);
           width: 4px;
           height: 4px;
           background: #10b981;
           border-radius: 50%;
           box-shadow: 0 0 4px rgba(16, 185, 129, 0.5);
       }

       .waypoint-header {
           display: flex;
           align-items: center;
           justify-content: space-between;
       }

       .waypoint-name {
           font-weight: 500;
           font-size: 13px;
           color: #f1f5f9;
       }

       .waypoint-preview {
           font-size: 11px;
           color: #94a3b8;
           font-family: 'Consolas', 'Monaco', monospace;
       }

       .waypoint-details {
           margin-top: 8px;
           padding: 8px;
           background: rgba(0, 0, 0, 0.4);
           border-radius: 4px;
           border-left: 2px solid #10b981;
           display: none;
           font-size: 11px;
       }

       .waypoint.expanded .waypoint-details {
           display: block;
           animation: expandDetails 0.2s ease;
       }

       @keyframes expandDetails {
           from {
               opacity: 0;
               transform: translateY(-4px);
           }
           to {
               opacity: 1;
               transform: translateY(0);
           }
       }

       .detail-row {
           display: flex;
           justify-content: space-between;
           margin-bottom: 4px;
       }

       .detail-row:last-child {
           margin-bottom: 0;
       }

       .detail-label {
           opacity: 0.7;
           font-weight: 500;
       }

       .detail-value {
           color: #f1f5f9;
       }


       .waypoint.standalone {
           border-bottom: 1px solid rgba(255, 255, 255, 0.05);
           margin-left: 0;
       }

       .waypoint.standalone::before {
           left: 8px;
       }

       .expand-controls {
           padding: 4px 6px;
           background: rgba(0, 0, 0, 0.2);
           display: flex;
           gap: 8px;
           border-bottom: 1px solid rgba(255, 255, 255, 0.05);
       }

       .btn-mini {
           padding: 4px 8px;
           border: 1px solid rgba(96, 165, 250, 0.3);
           background: rgba(96, 165, 250, 0.1);
           color: #93c5fd;
           border-radius: 4px;
           cursor: pointer;
           font-size: 11px;
           font-weight: 500;
           transition: all 0.2s ease;
       }

       .btn-mini:hover {
           background: rgba(96, 165, 250, 0.2);
           transform: translateY(-1px);
       }

       /* Demo container styling */
       .demo-container {
           max-width: 400px;
           margin: 0 auto;
           background: white;
           padding: 20px;
           border-radius: 12px;
           box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
       }

       .demo-header {
           margin-bottom: 16px;
           text-align: center;
       }

       .demo-content {
           background: #f8f9fa;
           padding: 12px;
           border-radius: 6px;
           margin-bottom: 16px;
           color: #6b7280;
           font-size: 13px;
           text-align: center;
       }
  </style>
</head>
<body>
<div id="popup-overlay" class="popup-overlay">
  <div class="popup">
      <h2>Session Paused</h2>
      <p>You've been inactive for a while. Press the button below to continue.</p>
      <button onclick="continueSession()">Continue</button>
  </div>
</div>
<div id="downtime-overlay" class="popup-overlay">
  <div class="popup">
      <h2>🔥 High Traffic Alert 🔥</h2>
      <p>We are experiencing a busy period. Pro subscribers please sign in to gain access!</p>
      <button onclick="downtimeSession()">Continue</button>
  </div>
</div>
<div id="discord-overlay" class="popup-overlay">
  <div class="popup">
      <h2>Have you tried flight notifications?</h2>
      <p>Tap the bell icon on a flight’s info card to get real-time push notifications!</p>
      <button onclick="downtimeSession()">Continue</button>
  </div>
</div>
<div id="notification-overlay" class="popup-overlay">
  <div class="popup" style="overflow: hidden;">
    <h2>Notifications enabled!</h2>
    <p>You will receive realtime notifications for the following stages of flight:</p>
    <p style="float: left; width: 100%; margin: 2px 0;">✓ Takeoff</p>
    <p style="float: left; width: 100%; margin: 2px 0;">✓ Initial cruise and descent</p>
    <p style="float: left; width: 100%; margin: 2px 0;">✓ Landing</p>
    <p style="float: left; width: 100%; margin: 2px 0;">✓ Diversions</p>
    <button onclick="downtimeSession()">Continue</button>
  </div>
</div>
<div id="profile-button" onclick="onSignInClick()" title="Profile and settings">👤</div>
<div id="favorites-button" onclick="toggleFavoritesPanel()" title="Saved flights" style="color: var(--accent-color)">☆</div>
<div id="favorites-popup" class="favorites-popup hidden" aria-live="polite">
  <div class="favorites-card" id="favoritesCard">
    <div class="favorites-header">
      <div>
        <h3>Saved Flights & Friends</h3>
        <p class="favorites-description">Bookmark aircraft for quick jumps or keep tabs on friends.</p>
      </div>
      <button class="btn-mini" id="clearFavoritesButton" style="display: none;">Clear Flights</button>
    </div>
    <p class="favorites-status" id="favorites-status"></p>
    <section class="favorites-section" aria-label="Saved flights">
      <div class="favorites-section-heading">
        <h4>Flights</h4>
        <span class="favorites-section-hint">Tap ☆ on a flight to add it here.</span>
      </div>
      <p class="favorites-empty" id="favorites-empty-state">Tap the ☆ button on a flight to pin it here.</p>
      <div class="favorites-list" id="favorites-list"></div>
    </section>
    <hr class="favorites-divider">
    <section class="favorites-section" aria-label="Favorite users">
      <div class="favorites-section-heading">
        <h4>Friends</h4>
        <span class="favorites-section-hint">Friends you add appear below with their status.</span>
      </div>
      <form class="favorites-search favorite-user-form" id="favorite-user-form">
        <input type="search" id="favorite-user-input" placeholder="Add friends by username" autocomplete="off" aria-label="Add friends by username">
      </form>
      <p class="favorites-section-hint favorites-privacy-hint">
        Local storage keeps your friends saved here.
        <button type="button" class="favorites-link" id="friend-storage-manage">Cookie preferences</button>
      </p>
      <p class="favorites-empty" id="favorite-users-empty">Add pilots to jump to them when they’re in the air.</p>
      <div class="favorites-list" id="favorite-users-list"></div>
    </section>
  </div>
</div>
<div id="friend-storage-banner" class="cookie-consent-banner hidden" role="dialog" aria-live="polite" aria-label="Local storage preferences">
  <div class="cookie-consent-content">
    <h4>Local storage permission</h4>
    <p>We can save your friends list and following flights on this device so they stay in the favorites menu.</p>
    <a class="cookie-consent-privacy" href="https://infiniteview.app/legal/privacy.html" target="_blank" rel="noopener">Privacy Policy</a>
  </div>
  <div class="cookie-consent-controls">
    <div class="consent-toggle">
      <span>Allow storage</span>
      <label class="switch">
        <input type="checkbox" id="friend-storage-toggle" aria-label="Allow saving friends and followed flights to local storage">
        <span class="slider"></span>
      </label>
    </div>
    <button class="btn-mini" type="button" id="friend-storage-dismiss">Done</button>
  </div>
</div>
<div id="sign-in-popup" class="hidden">
  <p id='sign-in-text1' style="text-align: center; font-size: 18px; font-weight: 600; margin-bottom: 16px;">Profile Menu</p>
  <div class="dropdown" id='profiledropdown'>
    <div style="margin-top: 15%" id="googleloginbutton" class="g_id_signin" data-type="standard" data-auto_prompt="false"></div>
    <p id='googleinfotext' style='color: var(--text-secondary); font-size: 12px; text-align: center; margin: 12px 0;'>By signing in with Google, you agree to our Privacy Policy and understand Google may set cookies.</p>
    <button style='display: none; background-color: var(--accent-color); color: var(--primary-bg); width: 100%; padding: 10px; border-radius: var(--border-radius-md); font-weight: 500; margin-bottom: 8px; border: none;' id="infiniteprobutton" onclick='getPro()'>Get Infinite View Pro</button>
    <button style='display: none; background-color: var(--tertiary-bg); color: var(--text-primary); width: 100%; padding: 10px; border-radius: var(--border-radius-md); font-weight: 500; margin-bottom: 16px; border: 1px solid rgba(255, 255, 255, 0.1);' id="logoutbutton" onclick="onSignOutClick()">Logout</button>
    <div id='dropdown'>
      <div id="switch-container" style='text-align: center;'>
      <span class="label">2D Paths</span>
        <label class="switch">
          <input type="checkbox" id="flightpath-switch">
          <span class="slider"></span>
        </label>
        <span class="label">3D Paths (experimental)</span>
      </div>
      <div id="switch-container" style='text-align: center;'>
      <span class="label">Direct path</span>
        <label class="switch">
          <input type="checkbox" id="flightplan-switch">
          <span class="slider"></span>
        </label>
        <span class="label">Flight Plan</span>
      </div>
    </div>
    <p style='color: var(--accent-color); font-size: 12px; text-align: center; margin: 16px 0;'>
      <span style="cursor: pointer;" onclick="window.open('https://infiniteview.app/legal/terms.html')">Terms of Use</span> |
      <span style="cursor: pointer;" onclick="window.open('https://infiniteview.app/legal/privacy.html')">Privacy Policy</span> |
      <span style="cursor: pointer;" onclick="window.open('https://infiniteview.app/legal/refundpolicy.html')">Refunds</span>
    </p>
    <hr>
    <p style='font-size: 13px; text-align: center; margin: 12px 0; color: var(--text-secondary);'>Plane icons by @Mohamed2030 ❤️</p>
    <a href="https://infiniteview.app/" style='display: block; text-align: center; margin: 8px 0;'>Learn more about InfiniteView Pro</a>
    <a href="/cdn-cgi/l/email-protection#9aedf3f6f6daf3f4fcf3f4f3eeffecf3ffedb4fbeaea" style='display: block; text-align: center; margin: 8px 0;'>Contact us</a>
  </div>
</div>
<header>
    <!-- Dropdown Menu -->
    <div class="dropdown">
        <button id='serverdropdown'>E</button>
        <div class="dropdown-content">
            <a onclick="changeServer('ed323139-baa7-4834-b9d6-5fb9f19ff11e')">Expert</a>
            <a onclick="changeServer('15f884a5-52ec-467e-bda5-414d4569544d')">Training</a>
            <a onclick="changeServer('1f5ff830-8e4d-4477-89e7-21c136d54844')">Casual</a>
        </div>
    </div>
    <div class="dropdown">
        <button onclick="showTrending('show')" id='rankingbutton'>🔥</button>
        <div class="search-results" id='rankingdropdown' style="min-width: 250px; top: 150%; padding-left: 5px;">
        </div>
    </div>
    <!-- Search Bar -->
    <div class="search-bar" id='search-bar'>
        <span class="icon" id='search-icon'>🔍</span>
        <input type="text" id="search-input" placeholder="Search callsign or username" onkeyup="showResults()" readonly>
        <div class="search-results" id="search-results">
            <!-- Search results will be injected here -->
        </div>
    </div>
</header>
<div id="mySidenav" class="sidenav" style="overflow-y: auto; scrollbar-width: none; -ms-overflow-style: none; ">
  <div class="container">
      <div class="full-width" id='1Box' style='padding: 0px; border-radius: 0px; border-top-left-radius: 10px; border-top-right-radius: 10px;'>
          <h2 id='1Title'></h2>
          <span id='1Text'></span>
          <br>
      </div>
      <div class="full-width" id='2Box' style="z-index: 10;">
        <div class="airportpage-header">
          <div class="airportpage-name" id="airportpage-name">Heathrow Airport</div>
          <div class="airportpage-code" id="airportpage-code">LHR</div>
        </div>

        <div class="airportpage-stats">
          <div class="airportpage-stat-row" style='padding-top: 15px;'>
            <span>Inbound Flights</span><span id="airportpage-inbound">--</span>
          </div>
          <div class="airportpage-stat-row">
            <span>Outbound Flights</span><span id="airportpage-outbound">--</span>
          </div>
        </div>

        <div class="airportpage-delay">
          <div class="airportpage-stat-row">
            <span>Delay Index</span><span id="airportpage-delayValue">--</span>
          </div>
          <div class="airportpage-bar">
            <div id="airportpage-barFill" class="airportpage-bar-fill"></div>
          </div>
        </div>
        <div class="airportpage-footer" id='airportpage-footer'>Flight data updated live</div>
      </div>
      <div class="full-width" id='flight-info-panel'>
        <div class="flight-header">
            <div class="flight-number" id="flight-number">Cargo 1</div>
            <div class="aircraft-type" id="aircraft-type">77F</div>
            <div class="status-badge trending" id="trendingBadge">#1 Trending</div>
            <div class="flight-actions">
                <button type="button" class="focus-toggle-button" id="focus-flight-button">Focus</button>
                <button type="button" class="focus-toggle-button favorite-toggle-button" id="favorite-flight-button">☆</button>
            </div>
        </div>
        <h3 id="airline-name" style='float: left; font-size: 12px;'>British Airways - Special Livery</h3>
        <div class='full-width' style="background-color: var(--tertiary-bg); padding-top: 7px; ">
          <div class="image-container" id='aircraftimage' style='display: block; border-radius: 0 0 0 0px;'></div>
        </div>
        <div class="flight-route" id='flight-route'>
            <div class="diversion-notice" id="diversionNotice">
                <div class="diversion-title">Flight Diverted</div>
                <div class="diversion-info">
                    <div class="diversion-airport">
                        <div class="diversion-code" id="diversion-code">MAN</div>
                        <div class="diversion-name" id="diversion-name">Manchester</div>
                    </div>
                    <div class="diversion-time" id="diversion-time">ETA 10:39</div>
                </div>
            </div>
            <div class="route-header">
                <div class="airport">
                    <div class="airport-main" style='float: left;' id="departure-airport">
                        <span style="font-size: 32px; color: white;">N/A <sup style="font-size: 14px;">[10:00]</sup></span>
                    </div>
                </div>
                <div class="airport">
                    <div class="airport-main" style='float: right;' id="arrival-airport">
                        <span style="font-size: 32px; color: white;"><sup style="font-size: 14px;">[10:30]</sup> N/A</span>
                    </div>
                </div>
            </div>
            <div style="display: flex; justify-content: space-between;">
              <div class="flight-duration" id='departure-time'>Actual (10:01)</div>
              <div class="flight-duration" id='arrival-time'>Estimated (10:32)</div>
            </div>
          </div>
            <div class="progress-section">
                <div class="progress-track">
                    <div class="progress-fill" id="progressFill"></div>
                </div>
                <div class="aircraft-icon" id="aircraftIcon"></div>
                <div class="route-points">
                    <div class="route-point active"></div>
                    <div class="route-point" id="arrivalPoint"></div>
                </div>
            </div>
            <div class="progress-center">
                <div class="progress-text" id="progressText">65km from destination</div>
            </div>
      </div>
      <div class="full-width" id='atisbox' style="display: block; overflow: auto">
        <div class="runway-section">
          <div class="runway-title">Active Runways</div>
          <div class="runway-info">
              <div class="runway-type">
                  <h4>Landing</h4>
                  <div class="runway-numbers" id="landing-runways"></div>
              </div>
              <div class="runway-type">
                  <h4>Departure</h4>
                  <div class="runway-numbers" id="departure-runways"></div>
              </div>
          </div>
          <div class="runway-legend">
              <div class="legend-item">
                  <div class="legend-color legend-green"></div>
                  <span>Good</span>
              </div>
              <div class="legend-item">
                  <div class="legend-color legend-yellow"></div>
                  <span>Crosswind</span>
              </div>
              <div class="legend-item">
                  <div class="legend-color legend-red"></div>
                  <span>Tailwind</span>
              </div>
          </div>
      </div>
        <div class="data-grid" style='display: none;'>
            <div class="data-card">
                <div class="card-title">Wind</div>
                <div class="card-value">
                    090° @ 8kt
                </div>
                <div class="card-unit">Variable 060-140°</div>
            </div>

            <div class="data-card">
                <div class="card-title">Visibility</div>
                <div class="card-value">21</div>
                <div class="card-unit">kilometers</div>
            </div>

            <div class="data-card">
                <div class="card-title">Temperature</div>
                <div class="card-value">26°C</div>
                <div class="card-unit">Dew Point: 13°C</div>
            </div>

            <div class="data-card">
                <div class="card-title">QNH</div>
                <div class="card-value">1024</div>
                <div class="card-unit">hectopascals</div>
            </div>
        </div>

        <div class="time-display">
            Updated: 10:24 ZULU
        </div>
        <span id='atistext'></span>
      </div>
      <div id="31Box">
          <span id="31Title">Altitude</span>
          <h2 id="31Text">--ft</h2>
      </div>
      <div id="32Box">
          <span id="32Title">VS</span>
          <h2 id="32Text">+- ft/min</h2>
      </div>
      <div id="41Box">
          <span id="41Title">Heading</span>
          <h2 id="41Text">---deg</h2>
      </div>
      <div id="42Box">
          <span id="42Title">Ground Speed</span>
          <h2 id="42Text">---kts</h2>
      </div>
      <div id='51Box'>
          <span id="51Title">ETA</span>
          <h2 id="51Text">---min</h2>
      </div>
      <div id='52box'>
          <span id="52Title">Status</span>
          <h2 id="52Text" style="color: var(--success-color);">On time</h2>
      </div>
      <div class='full-width' id='flightplan'>
        <div class="waypoints-widget collapsed" id="waypoints-widget">
          <div class="toggle-header" onclick="toggleWidget()">
              <div class="toggle-title">
                  <span class="toggle-icon">ᣛ</span>
                  View Flight Plan
              </div>
              <div class="stats-mini">
                  <span style='font-size: 10px;'><span id="total-waypoints" style='font-size: 10px;'>-</span> waypoints</span>
              </div>
          </div>

          <div class="content">
              <div class="expand-controls">
                  <button class="btn-mini" onclick="expandAll()">Expand All</button>
                  <button class="btn-mini" onclick="collapseAll()">Collapse All</button>
              </div>
              <div id="waypoints-container">
                  <!-- Waypoints will be populated here -->
              </div>
          </div>
        </div>
      </div>
      <div class="full-width" id='6box' style="display: block; overflow: auto; max-height: 320px;">
          <div class="graph-header">
            <div>
              <div class="graph-subtitle" id="graph-subtitle">Drag the timeline to replay this flight.</div>
            </div>
            <button class="btn-mini" id="replay-exit" style="display: none;">Exit replay</button>
          </div>
          <canvas id='canvas' style='display: none;'></canvas>
          <div class="replay-controls" id="replay-controls" style="display: none;">
            <input type="range" id="replay-slider" min="0" max="0" value="0" step="1">
            <div class="replay-meta">
              <span id="replay-timestamp">--:--:--</span>
              <span id="replay-altitude">-- ft</span>
              <span id="replay-speed">-- kts</span>
            </div>
          </div>
      </div>
      <div class="full-width" id='7box' style="display: block; overflow: auto; max-height: 300px;">
          <span>Virtual Org</span>
          <h2>InfiniteView [IFV]</h2>
      </div>
      <div class='full-width' style='margin: 0px; max-height: 1000px;' id='8box'>
        <div class="profile-card">
          <div class="profile-header">
            <div style="display: flex; align-items: center; justify-content: center; gap: 10px; flex-wrap: wrap;">
              <button class="circle-button" id='notification-button'>🔕</button>
              <h3 id='user-title'>User Profile</h3>
              <button class="circle-button" id='pair-button'>Pair</button>
            </div>
          </div>
          <div class="profile-content">
              <div class="section">
                  <h3>XP</h3>
                  <p id='81Text'>5000</p>
              </div>
              <div class="section">
                  <h3>Grade</h3>
                  <p id='101Text'>A</p>
              </div>
              <div class="section">
                  <h3># Flights</h3>
                  <p id='102Text'>A</p>
              </div>
              <div class="section">
                  <h3>Flight Hours</h3>
                  <p id='91Text'>150</p>
              </div>
              <div class="section">
                  <h3>Landings</h3>
                  <p id='92Text'>120</p>
              </div>
              <div class="section">
                  <h3>Violations</h3>
                  <p id='82Text'>2</p>
              </div>
              <p style="text-align: center; color: white; font-size: 10px" id="flight-secret">secret</p>
          </div>
          <div class="flight-history-section">
              <button class="flight-history-toggle-button" id="flightHistoryToggle">
                  <span><i class="fas fa-plane"></i> Show Flight History</span>
                  <i class="fas fa-chevron-down"></i>
              </button>

              <div class="flight-history-flights-container" id="flightHistoryFlightsContainer">
                  <div class="flight-history-flight-list" id="flightHistoryFlightList">
                      <div class="flight-history-loading">
                          <i class="fas fa-circle-notch"></i>
                          <p>Loading flight data...</p>
                      </div>
                  </div>
              </div>
          </div>
      </div>
    </div>
    <div class='full-width' style='margin: 0px;' id='globebox'>
      <h2 id='globetext'></h2>
    </div>
  </div>
</div>
<div id="MapContainer" style="min-height: 100%;"></div>
<div class="filter-container" id="filter-container">
    <div class="filter-button" onclick="toggleFilter()">
        <svg class="filter-icon" viewBox="0 0 24 24">
            <path d="M4.25 5.61C6.27 8.2 10 13 10 13v6c0 .55.45 1 1 1h2c.55 0 1-.45 1-1v-6s3.73-4.8 5.75-7.39c.51-.66.04-1.61-.79-1.61H5.04c-.83 0-1.3.95-.79 1.61z"/>
        </svg>
        Filter Planes
        <span id="filter-count" style="display: none; background: #FFC300; border-radius: 10px; padding: 2px 6px; font-size: 11px; margin-left: 4px;"></span>
    </div>

    <div class="filter-panel" id="filterPanel">
        <div class="input-container">
            <input
                type="text"
                class="search-input"
                id="searchInput"
                placeholder="Type to filter: 'American above 30000 feet' or 'flights to JFK'"
                autocomplete="off"
            >

            <div class="suggestions" id="suggestions"></div>
        </div>

        <div class="filter-tags" id="filterTags"></div>

        <div class="filter-actions">
            <button class="btn btn-primary" onclick="applyFilters()">Apply Filters</button>
            <button class="btn btn-secondary" onclick="clearFilters()">Clear All</button>
        </div>

        <div class="status-text" id="statusText">
            Enter natural language filters like "Delta flights above 25000" or "flights to LAX"
        </div>
    </div>
</div>
  <script data-cfasync="false" src="/cdn-cgi/scripts/5c5dd728/cloudflare-static/email-decode.min.js"></script><script type="text/javascript"></script>
  <link href="https://api.mapbox.com/mapbox-gl-js/v3.13.0/mapbox-gl.css" rel="stylesheet">
  <script src="https://api.mapbox.com/mapbox-gl-js/v3.13.0/mapbox-gl.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/@turf/turf/turf.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/threebox-plugin@2.2.7/dist/threebox.min.js"></script>
  <link href="https://cdn.jsdelivr.net/npm/threebox-plugin@2.2.7/dist/threebox.min.css" rel="stylesheet">
  <link rel="stylesheet" href="./resources/ifhubsearch.css">
  <script src="https://accounts.google.com/gsi/client" async defer></script>
  <script>

  // NOTIFCATION handler

  let swRegistration = null;
  let isSubscribed = false;

  // Initialize the app
  if ('serviceWorker' in navigator && 'PushManager' in window) {
      initializeApp();
  } else {
      showStatus('Push notifications are not supported in this browser.', 'error');
  }

  function showStatus(msg, type){
    console.log(msg, type)
  }

  async function initializeApp() {
    try {
        // Register service worker
        swRegistration = await navigator.serviceWorker.register('./resources/sw.js?123');
        console.log('Service Worker registered');

        // Wait for the service worker to be ready
        await navigator.serviceWorker.ready;
        console.log('Service Worker is ready');

        // Check if already subscribed
        const subscription = await swRegistration.pushManager.getSubscription();
        isSubscribed = !(subscription === null);
    } catch (error) {
        console.error('Service Worker registration failed:', error);
        showStatus('Failed to initialize notifications. Please refresh the page.', 'error');
    }
  }

  async function enableNotifications(fid) {
      try {
          // Ensure service worker is ready before proceeding
          if (!swRegistration || !swRegistration.active) {
              await navigator.serviceWorker.ready;
              swRegistration = await navigator.serviceWorker.getRegistration();
          }

          // Request permission
          const permission = await Notification.requestPermission();
          if (permission !== 'granted') {
              showStatus('Notification permission denied. Please enable it in your browser settings.', 'error');
              return;
          }

          // Check if we already have a subscription
          let subscription = await swRegistration.pushManager.getSubscription();
          if (!subscription) {
              // Only create a new subscription if one doesn't exist
              const vapidResponse = await fetch('https://api.infiniteview.app/public-key');
              const vapidData = await vapidResponse.json();
              subscription = await swRegistration.pushManager.subscribe({
                  userVisibleOnly: true,
                  applicationServerKey: urlBase64ToUint8Array(vapidData.public_key)
              });
          }

          // Send subscription to server for this specific flight
          const response = await fetch('https://api.infiniteview.app/subscribe?flightid=' + fid, {
              method: 'POST',
              headers: {
                  'Content-Type': 'application/json'
              },
              body: JSON.stringify(subscription)
          });

          const result = await response.json();
          if (result.success) {
              isSubscribed = true;
          } else {
              showStatus('Failed to subscribe to notifications.', 'error');
          }
      } catch (error) {
          console.error('Error enabling notifications:', error);
          showStatus('Error enabling notifications. Please try again.', 'error');
      }
  }

  async function disableNotifications(fid) {
      try {
          const subscription = await swRegistration.pushManager.getSubscription();

          if (subscription) {
              await subscription.unsubscribe();
              // Tell server to remove subscription
              await fetch('https://api.infiniteview.app/unsubscribe?flightid='+fid, {
                  method: 'POST',
                  headers: {
                      'Content-Type': 'application/json'
                  },
                  body: JSON.stringify(subscription)
              });
          }

          isSubscribed = false;
          showStatus('Notifications disabled successfully.', 'info');
      } catch (error) {
          console.error('Error disabling notifications:', error);
          showStatus('Error disabling notifications. Please try again.', 'error');
      }
  }

  function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding)
        .replace(/\-/g, '+')
        .replace(/_/g, '/');

    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);

    for (let i = 0; i < rawData.length; ++i) {
        outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
  }



  const sidenav = document.getElementById('mySidenav');

  // Check if the device is mobile
  const isMobile = window.matchMedia("(max-width: 768px)").matches;

  if (isMobile) {
    //window.location.replace("https://infiniteview.app/temp");
    let isExpanded = false;
    document.getElementById('filter-container').style.top = '65px';
    sidenav.addEventListener('scroll', () => {
        const scrollTop = sidenav.scrollTop;

        // If scrolled more than 10px, expand the div
        if (scrollTop >= 30 && !isExpanded) {
            sidenav.style.top='20%'
            isExpanded = true; // Set flag to prevent repeated expansion
        }

        // If scrolled back up to less than 10px, collapse the div
        else if (scrollTop < 5 && isExpanded) {
            sidenav.style.top = '73%'
            isExpanded = false; // Reset flag
        }
    });
  }

  var allowEditingScheduledTimes = false; // Set to true to enable editing

  // Variables to store edited times for API submission
  let editedTimes = {
      departureScheduled: null,  // Format: "YYYY-MM-DD HH:MM"
      arrivalScheduled: null,    // Format: "YYYY-MM-DD HH:MM"
      departureActual: null,     // Format: "YYYY-MM-DD HH:MM"
      arrivalActual: null        // Format: "YYYY-MM-DD HH:MM"
  };

  // Original times (fallback values)
  let originalTimes = {
      departureScheduled: "10:00",
      arrivalScheduled: "10:30",
      departureActual: "10:01",
      arrivalActual: "10:32"
  };

  // Get current date for datetime-local input
  function getCurrentDate() {
      const today = new Date();
      return today.toISOString().split('T')[0]; // Returns YYYY-MM-DD format
  }

  // Convert time to datetime-local format
  function timeToDatetimeLocal(time, baseDate = null) {
      const date = baseDate || getCurrentDate();
      return `${date}T${time}`;
  }

  // Extract date and time from datetime-local format
  function extractDateAndTime(datetimeLocal) {
      const [date, time] = datetimeLocal.split('T');
      return { date, time };
  }

  // Function to initialize editable times
  function initializeEditableTimes() {
      if (!allowEditingScheduledTimes) return;

      // Find time elements in the DOM
      const departureAirport = document.getElementById('departure-airport');
      const arrivalAirport = document.getElementById('arrival-airport');

      if (departureAirport) {
          makeTimeEditable(departureAirport, 'departureScheduled', extractScheduledTime(departureAirport.innerHTML));
      }

      if (arrivalAirport) {
          makeTimeEditable(arrivalAirport, 'arrivalScheduled', extractScheduledTime(arrivalAirport.innerHTML));
      }
  }

  // Function to extract scheduled time from HTML content
  function extractScheduledTime(htmlContent) {
      const match = htmlContent.match(/\[(\d{2}:\d{2})\]/);
      return match ? match[1] : null;
  }

  // Function to extract actual time from HTML content
  function extractActualTime(htmlContent) {
      const match = htmlContent.match(/\((\d{2}:\d{2})\)/);
      return match ? match[1] : null;
  }

  // Function to make time elements editable
  function makeTimeEditable(element, timeType, currentTime) {
      if (!currentTime) return;

      // Store original time
      originalTimes[timeType] = currentTime;

      // Add click event to make editable
      element.style.cursor = 'pointer';
      element.title = 'Click to edit date and time';

      element.addEventListener('click', function(e) {
          // Prevent event bubbling
          e.stopPropagation();
          if (allowEditingScheduledTimes == false){
            return e
          }

          // Create datetime-local input field
          const input = document.createElement('input');
          input.type = 'datetime-local';
          input.value = timeToDatetimeLocal(currentTime);
          input.style.cssText = `
              background: var(--tertiary-bg);
              border: 2px solid var(--accent-color);
              border-radius: 4px;
              color: var(--text-primary);
              padding: 4px;
              font-size: 14px;
              width: 180px;
          `;

          // Position input over the clicked element
          const rect = e.target.getBoundingClientRect();
          input.style.position = 'absolute';
          input.style.left = rect.left + 'px';
          input.style.top = rect.top + 'px';
          input.style.zIndex = '9999';

          // Add input to body
          document.body.appendChild(input);
          input.focus();

          // Handle input completion
          function completeEdit() {
              const newDateTime = input.value;
              if (newDateTime && isValidDateTime(newDateTime)) {
                  const { date, time } = extractDateAndTime(newDateTime);
                  const fullDateTime = `${date} ${time}`;

                  updateTime(element, timeType, time, date);
                  editedTimes[timeType] = fullDateTime;
                  console.log(`Updated ${timeType}:`, fullDateTime);
                  console.log('All edited times:', editedTimes);
                  sendEditedTimesToAPI()
                  // Remove highlight after a brief delay to show the edit was successful
                  setTimeout(() => {
                      removeHighlight(element);
                  }, 1500);
              }
              document.body.removeChild(input);
          }

          // Handle input events
          input.addEventListener('blur', completeEdit);
          input.addEventListener('keydown', function(e) {
              if (e.key === 'Enter') {
                  completeEdit();
              } else if (e.key === 'Escape') {
                  document.body.removeChild(input);
              }
          });
      });
  }

  // Function to validate datetime format
  function isValidDateTime(datetime) {
      const datetimeRegex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
      return datetimeRegex.test(datetime);
  }

  // Function to validate time format (kept for backwards compatibility)
  function isValidTime(time) {
      const timeRegex = /^([01]?[0-9]|2[0-3]):[0-5][0-9]$/;
      return timeRegex.test(time);
  }

  function updateTime(element, timeType, newTime, newDate = null) {
      const currentHTML = element.innerHTML;

      if (timeType.includes('Scheduled')) {
          // Update scheduled time in brackets - only show time
          element.innerHTML = currentHTML.replace(/\[\d{2}:\d{2}\]/, `[${newTime}]`);
      } else if (timeType.includes('Actual')) {
          // Update actual time in parentheses - only show time
          element.innerHTML = currentHTML.replace(/\(\d{2}:\d{2}\)/, `(${newTime})`);
      }

      // Add visual indicator that time was edited (temporarily)
      element.style.backgroundColor = 'rgba(255, 195, 0, 0.1)';
      element.style.border = '1px solid var(--accent-color)';
      element.style.borderRadius = '4px';
  }

  // Function to remove highlight from element
  function removeHighlight(element) {
      element.style.backgroundColor = '';
      element.style.border = '';
      element.style.borderRadius = '';
  }

  // Function to get all edited times for API submission
  function getEditedTimesForAPI() {
      const timesToSend = {};

      // Only include times that have been actually edited
      Object.keys(editedTimes).forEach(key => {
          if (editedTimes[key] !== null) {
              timesToSend[key] = editedTimes[key];
          }
      });

      return timesToSend;
  }

  // Function to reset all edited times
  function resetEditedTimes() {
      editedTimes = {
          departureScheduled: null,
          arrivalScheduled: null,
          departureActual: null,
          arrivalActual: null
      };

      // Remove visual indicators
      const elements = [
          document.getElementById('departure-airport'),
          document.getElementById('arrival-airport'),
          document.getElementById('departure-time'),
          document.getElementById('arrival-time')
      ];

      elements.forEach(el => {
          if (el) {
              removeHighlight(el);
          }
      });
  }

  // Function to enable/disable editing
  function toggleEditingMode(enable) {
      allowEditingScheduledTimes = enable;

      if (enable) {
          console.log('Editing mode enabled');
          initializeEditableTimes();
      } else {
          console.log('Editing mode disabled');
          resetEditedTimes();
      }
  }

  // Function to send edited times to API
  async function sendEditedTimesToAPI() {
      const timesToSend = getEditedTimesForAPI();

      if (Object.keys(timesToSend).length === 0) {
          console.log('No times have been edited');
          return;
      }

      console.log('Sending edited times to API:', timesToSend);

      try {
          // Replace with your actual API endpoint
          if (timesToSend.departureScheduled != null){
            start = new Date(timesToSend.departureScheduled).getTime()
          } else {
            start = 123
          }

          if (timesToSend.arrivalScheduled != null){
            end = new Date(timesToSend.arrivalScheduled).getTime()
          } else {
            end = 123
          }

          const response = await fetch('https://api.infiniteview.app/change-schedule?apikey=ZNvNHJYC5IcLYUMlFpBI&userkey='+localStorage.getItem('InfiniteFlightPairing')+'&flightid='+editFid+'&start='+start+'&end='+end, {
              method: 'GET',
              headers: {
                  'Content-Type': 'application/json',
              },
          });

          if (response.ok) {
              const data = await response.json();
              console.log('Response data:', data);
              console.log('Times successfully updated');
          } else {
              console.error('Failed to update times:', response.statusText);
          }
      } catch (error) {
          console.error('Error sending times to API:', error);
      }
  }

  // Initialize when DOM is loaded
  document.addEventListener('DOMContentLoaded', function() {
      // Auto-initialize if editing is enabled
      if (allowEditingScheduledTimes) {
          setTimeout(initializeEditableTimes, 1000); // Delay to ensure DOM is ready
      }
  });

  // Example usage functions (you can call these from console or other scripts)
  function enableEditing() {
      toggleEditingMode(true);
  }

  function disableEditing() {
      toggleEditingMode(false);
  }

  function logCurrentEditedTimes() {
      console.log('Currently edited times:', getEditedTimesForAPI());
  }

  // Export functions for global access
  window.flightTimeEditor = {
      enableEditing,
      disableEditing,
      getEditedTimes: getEditedTimesForAPI,
      sendToAPI: sendEditedTimesToAPI,
      resetTimes: resetEditedTimes,
      logTimes: logCurrentEditedTimes
  };

  // Calculate wind components for runway
  function calculateWindComponents(windDirection, windSpeed, runwayHeading) {
      const windRad = (windDirection * Math.PI) / 180;
      const runwayRad = (runwayHeading * Math.PI) / 180;

      const headwindComponent = windSpeed * Math.cos(windRad - runwayRad);
      const crosswindComponent = Math.abs(windSpeed * Math.sin(windRad - runwayRad));

      return {
          headwind: headwindComponent, // positive = headwind, negative = tailwind
          crosswind: crosswindComponent
      };
  }

  // Get runway heading from runway designation (e.g., "09L" -> 90 degrees)
  function getRunwayHeading(runwayDesignation) {
      const numericPart = parseInt(runwayDesignation.replace(/[LRC]/, ''));
      return numericPart * 10;
  }

  // Determine wind condition color for a runway
  function getWindConditionColor(windDirection, windSpeed, runwayDesignation) {
      const runwayHeading = getRunwayHeading(runwayDesignation);
      const components = calculateWindComponents(windDirection, windSpeed, runwayHeading);

      // Check for tailwind (5+ kts) - RED
      if (components.headwind < -5) {
          return 'red';
      }

      // Check for crosswind (5+ kts) - YELLOW
      if (components.crosswind >= 5) {
          return 'yellow';
      }

      // Otherwise - GREEN
      return 'green';
  }

  // Get overall wind condition for multiple runways (for wind arrow color)
  function getOverallWindCondition(windDirection, windSpeed, runways) {
      const conditions = runways.map(runway =>
          getWindConditionColor(windDirection, windSpeed, runway)
      );

      // Priority: red > yellow > green
      if (conditions.includes('red')) return 'red';
      if (conditions.includes('yellow')) return 'yellow';
      return 'green';
  }

  // ATIS Parser Function
  function parseATIS(atisString) {
      const data = {
          airport: "",
          information: "",
          time: "",
          wind: { direction: "", speed: "", variable: "" },
          visibility: "",
          temperature: "",
          dewPoint: "",
          qnh: "",
          runways: { landing: [], departure: [] }
      };

      // Extract airport code (first word)
      const airportMatch = atisString.match(/^(\w+)/);
      if (airportMatch) data.airport = airportMatch[1];

      // Extract information letter
      const infoMatch = atisString.match(/information (\w+)/i);
      if (infoMatch) data.information = infoMatch[1];

      // Extract time
      const timeMatch = atisString.match(/time (\d{4}) ZULU/i);
      if (timeMatch) data.time = timeMatch[1] + " ZULU";

      // Extract wind information
      const windMatch = atisString.match(/Wind (\d{3}) at (\d+)/i);
      if (windMatch) {
          data.wind.direction = windMatch[1];
          data.wind.speed = windMatch[2];
      }

      // Extract variable wind
      const variableMatch = atisString.match(/variable between (\d{3}) and (\d{3})/i);
      if (variableMatch) {
          data.wind.variable = `${variableMatch[1]}-${variableMatch[2]}`;
      }

      // Extract visibility
      const visMatch = atisString.match(/Visibility (\d+)/i);
      if (visMatch) data.visibility = visMatch[1];

      // Extract temperature
      const tempMatch = atisString.match(/Temperature (\d+)/i);
      if (tempMatch) data.temperature = tempMatch[1];

      // Extract dew point
      const dewMatch = atisString.match(/Dew Point (\d+)/i);
      if (dewMatch) data.dewPoint = dewMatch[1];

      // Extract QNH
      const qnhMatch = atisString.match(/QNH (\d+)/i);
      if (qnhMatch) data.qnh = qnhMatch[1];

      // Extract landing runways - improved parsing to stop at period or comma
      const landingMatch = atisString.match(/Landing Runways?\s+([^.,]+)/i);
      if (landingMatch) {
        // Normalize separators: replace " and " with commas
        const runwaysText = landingMatch[1].replace(/\band\b/gi, ",");
        // Split on commas, trim spaces, remove empties
        data.runways.landing = runwaysText
          .split(/[,/]/)
          .map(r => r.trim())
          .filter(r => r.length > 0);
      }
      // Extract departure runways - improved parsing to stop at period or comma
      const departureMatch = atisString.match(/Departing Runways?\s+([^.,]+)/i);
      if (departureMatch) {
        // Normalize separators: convert "and" to commas
        const runwaysText = departureMatch[1].replace(/\band\b/gi, ",");
        // Split on commas or slashes, trim, and remove empties
        data.runways.departure = runwaysText
          .split(/[,/]/)
          .map(r => r.trim())
          .filter(r => r.length > 0);
      }

      return data;
  }

  // Create individual runway elements with color coding
  function createRunwayElements(runways, windDirection, windSpeed) {
      return runways.map(runway => {
          const condition = getWindConditionColor(windDirection, windSpeed, runway);
          return `<div class="runway-item runway-${condition}">${runway}</div>`;
      }).join('');
  }

  function updateDisplay(data) {
      const windDirection = parseInt(data.wind.direction);
      const windSpeed = parseInt(data.wind.speed);

      // Update wind card
      const windCard = document.querySelector('.data-card .card-value');
      windCard.innerHTML = `${data.wind.direction}° @ ${data.wind.speed}kt`;

      // Update other cards
      const cards = document.querySelectorAll('.data-card');
      cards[1].querySelector('.card-value').textContent = data.visibility;
      cards[2].querySelector('.card-value').textContent = `${data.temperature}°C`;
      cards[2].querySelector('.card-unit').textContent = `Dew Point: ${data.dewPoint}°C`;
      cards[3].querySelector('.card-value').textContent = data.qnh;

      // Update runways with individual color coding
      const landingRunwaysEl = document.getElementById('landing-runways');
      const departureRunwaysEl = document.getElementById('departure-runways');

      // Create individual runway elements with their own colors
      landingRunwaysEl.innerHTML = createRunwayElements(data.runways.landing, windDirection, windSpeed);
      departureRunwaysEl.innerHTML = createRunwayElements(data.runways.departure, windDirection, windSpeed);

      // Update time
      document.querySelector('.time-display').textContent = `Updated: ${data.time}`;
  }


    // Authentication stuff

    function onSignInClick() {
       popup = document.getElementById('sign-in-popup');
       if (popup.style.display == 'block'){
         popup.style.display = 'none';
       } else {
         popup.style.display = 'block';
       }
     }

     function onSignOutClick(){
       localStorage.removeItem('JWT')
       google.accounts.id.disableAutoSelect();
       document.getElementById('googleloginbutton').style.display = 'block'
       document.getElementById('infiniteprobutton').style.display = 'none'
       document.getElementById('logoutbutton').style.display = 'none'
       document.getElementById('sign-in-text1').innerHTML = 'Profile Menu'
       document.getElementById('googleinfotext').style.display = 'block'
       if (document.getElementById('googleButton')){
         document.getElementById('googleButton').style.display = 'block'
       } else {
         div = document.getElementById('profiledropdown')
         newElement = "<button style = 'display: block; background-color: #FFC300; justify-content: center; align-items: center;'id='googleButton' >Sign in with Google</button>"
         div.insertAdjacentHTML('afterbegin', newElement);
         document.getElementById('googleButton').addEventListener("click", function() {
           const CLIENT_ID = "816537345417-9berue02lssgo8uumj8rhpcppk89givo.apps.googleusercontent.com";

           // Initialize the Google Identity Services
           google.accounts.id.initialize({
             client_id: CLIENT_ID,
             callback: handleCredentialResponse,
           });
           google.accounts.id.renderButton(
             document.getElementById("googleButton"), // The DOM element for the button
             { theme: "outline", size: "large" } // Customization options
           );

           // Optionally prompt the user immediately
           google.accounts.id.prompt(); // Optional for auto sign-in
         });
       }
     }

    if (localStorage.getItem("JWT") !== null){
      handleCredentialResponse({credential : localStorage.getItem("JWT")}, 'false')
    } else {
      div = document.getElementById('profiledropdown')
      newElement = "<button style = 'display: block; background-color: #FFC300; justify-content: center; align-items: center;'id='googleButton' >Sign in with Google</button>"
      div.insertAdjacentHTML('afterbegin', newElement);
      document.getElementById('googleButton').addEventListener("click", function() {
        const CLIENT_ID = "816537345417-9berue02lssgo8uumj8rhpcppk89givo.apps.googleusercontent.com";

        // Initialize the Google Identity Services
        google.accounts.id.initialize({
          client_id: CLIENT_ID,
          callback: handleCredentialResponse,
        });
        google.accounts.id.renderButton(
          document.getElementById("googleButton"), // The DOM element for the button
          { theme: "outline", size: "large" } // Customization options
        );

        // Optionally prompt the user immediately
        google.accounts.id.prompt(); // Optional for auto sign-in
      });
    }

    function getPro(){
      email = parseJwt(localStorage.getItem("JWT")).email
      popup = window.open("https://infiniteviewapp.lemonsqueezy.com/buy/4a1eed0c-16de-4b5f-86c2-d236fb69095d?checkout[email]="+email, "popupWindow", "width=600,height=400");

      const checkPopupClosed = setInterval(() => {
          if (popup.closed) {
              clearInterval(checkPopupClosed); // Stop checking once it's closed
              handleCredentialResponse({credential : localStorage.getItem("JWT")}, 'false')
          }
      }, 500);
    }

    function cancelSub(){
      jwt = localStorage.getItem("JWT")
      fetch('https://api.infiniteview.app/cancel-subscription', {
          method: 'POST',
          headers: {
              'Content-Type': 'application/json',
          },
          body: JSON.stringify({ token: jwt }),
      })
      .then(response => response.json())
      .then(data => {
          if (data.status == 'verified' && data.result == 'success') {
            document.getElementById('sign-in-text1').innerHTML = 'Hi, ' + parseJwt(jwt).name.split(' ')[0] + '.<br> Your subscription will be cancelled at the end of this billing period.'
            document.getElementById('infiniteprobutton').style.display = 'none'
          } else {
            document.getElementById('sign-in-text').innerHTML = 'Subscription cancellation failed.<br>Please log out and try again.'
          }
      })
      .catch(error => {
          console.error('Error verifying token:', error);
      });
    }

    function handleCredentialResponse(response, skip='false') {
        const jwt = response.credential;

        // Decode the JWT to extract user information
        const userInfo = parseJwt(jwt);
        //document.getElementById('infiniteprobutton').style.display = 'flex'
        document.getElementById('sign-in-text1').innerHTML = 'Hi!'
        document.getElementById('googleloginbutton').style.display = 'none'
        document.getElementById('logoutbutton').style.display = 'flex'
        localStorage.setItem('JWT', jwt)
        // here we check if they have pro,  if they do load the pro stuff.
        fetch('https://api.infiniteview.app/verify-token', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ token: jwt }),
        })
        .then(response => response.json())
        .then(data => {
            if (data.link != 'null'){
              document.getElementById('sign-in-text1').innerHTML = "Hi!<br>Manage your account <a onclick=\"window.open('"+data.link+"', 'popupWindow', 'width=600,height=400')\" style='color: #FFC300;'>here</a>";
              try{
                document.getElementById('googleButton').style.display = 'none';
              } catch(err){
                console.log('Logged in')
              }
            }
            if (data.status == 'verified' && data.url != 'null') {
                // If the user has "Pro" access, load the pro.js script
                if (skip == 'true'){
                  location.reload()
                } else {
                  console.log('Loading Pro features')
                  var script = document.createElement('script');
                  script.src = data.url+'?2111';
                  script.type = 'text/javascript';
                  document.head.appendChild(script);
                  document.getElementById('googleinfotext').style.display = 'none'
                  document.getElementById('infiniteprobutton').style.display = 'none'
                  setTimeout(function(){markerBehaviour()},5000); // Assuming this manages Pro features for the user
                }
            } else {
                if (data.status == 'not verified'){
                  onSignOutClick()
                  document.getElementById('googleButton').style.display = 'block';
                } else {
                    document.getElementById('infiniteprobutton').style.display = 'flex'
                    document.getElementById('infiniteprobutton').innerHTML = 'Subscribe to Pro'
                    document.getElementById('infiniteprobutton').onclick = getPro
                }
            }
        })
        .catch(error => {
            console.error('Error verifying token:', error);
        });
    }

      // Function to decode the JWT token
    function parseJwt (token) {
        const base64Url = token.split('.')[1];
        const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
        const jsonPayload = decodeURIComponent(atob(base64).split('').map(function(c) {
            return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
        }).join(''));

        return JSON.parse(jsonPayload);
    }

    var loop;
    function inititateTimeout(){
      clearInterval(loop)
      showPopup()
    }

    function resetInactivityTimer() {
        clearTimeout(inactivityTimeout);
        inactivityTimeout = setTimeout(inititateTimeout, inactivityTime);
    }

    function showPopup() {
        document.getElementById('popup-overlay').classList.add('active');
    }

    function continueSession() {
        document.getElementById('popup-overlay').classList.remove('active');
        refreshCounterForATC = 5
        resetInactivityTimer();
        airport(serverurl)
        refresh()
        loop = setInterval(refresh, 30000);
    }

    function downtimeSession() {
        document.getElementById('downtime-overlay').classList.remove('active');
        document.getElementById('discord-overlay').classList.remove('active');
        document.getElementById('notification-overlay').classList.remove('active');
        resetInactivityTimer();
    }

    // Track user activity
    window.onload = resetInactivityTimer;
    window.onmousemove = resetInactivityTimer;
    window.onkeydown = resetInactivityTimer;


      var UPDATING = 'no';
      var TYPE = '';
      var LOADING = false
      var PLANE_BEING_VIEWED = '';
      var PREVIOUS_FLIGHTS_LINK = ''
      var PLANE_BEING_VIEWED_DETAILS = {};
      var GLOBAL_LOCATION = false;
      let inactivityTime = 5*60000; // 30 seconds for demonstration; adjust as needed
      let inactivityTimeout;
      // Hide results when clicking outside the search bar
      document.addEventListener('click', function(event) {
          const searchBar = document.querySelector('.search-bar');
          const resultsContainer = document.getElementById('search-results');
          const trendingButton = document.getElementById('rankingbutton');
          const profileButton = document.getElementById('profile-button');
          const popup = document.getElementById('sign-in-popup');
          if (!searchBar.contains(event.target)) {
              if(!trendingButton.contains(event.target)){
                resultsContainer.style.display = 'none';
                filteredTerms = [];
                if (!popup.contains(event.target) && !profileButton.contains(event.target)){
                  popup.style.display = 'none';
                }
              }
          }
      });

      function markerBehaviour(){}
      function getPlaneIcon(username, aircraftId){
        team = ["WML", "Lewis", "VanillaCakePeople", "Mohamed2030", "ka77", "boeair", "Adam", "Niimble", "Captain_zane", "Saf"]
        ifstaff = ["philippe", "jasonrosewell", "Cameron", "Dan", "schyllberg", "jarno80", "RAH", "Laura", "Tyler_Shelton"]
        if (team.includes(username)){
          return 'testspecialplaneicon'
        }else if (ifstaff.includes(username)){
          return 'testinfinitespecialplaneicon'
        } else if (username == 'Santa Claus'){
          return 'santaicon'
          console.log('CHANGED TO SANTA ICON')
        } else {
          return 'testplaneicon'
        }
      }

      function openNav() {
        ifclick = 'yes';
        try {
          document.getElementById('canvas').style.display = 'none';
        } catch(err){
          null;
        }
        const isMobile = window.matchMedia("(max-width: 768px)").matches;
        if (isMobile){
          document.getElementById("mySidenav").style.top = '73%'
          document.getElementById("mySidenav").style.width = '95%';
          document.getElementById("mySidenav").style.left = '2.5%';
        } else {
          document.getElementById("mySidenav").style.top = '10%'
        }
        //document.getElementById("mySidenav").style.height = "280px";
        document.getElementById("mySidenav").style.display = "block";
        document.getElementById("mySidenav").style.backgroundColor = 'transparent'

          //document.getElementById("MapContainer").style.marginTop = "280px";
      }

      function closeNav() {
        if (UPDATING == 'no'){
          ifclick = 'no'
          // we do NOT change the PLANE_BEING_VIEWED, for reasons in my head
        }

        try{
          document.getElementById('canvas').style.display = 'none'
          myLineChart.destroy();
        }
        catch(err){
          null;
        }

        exitReplayMode();

        //document.getElementById("mySidenav").style.height = "0";
        document.getElementById("mySidenav").style.display = "none"

        if (document.getElementById('flightHistoryFlightsContainer').classList.contains('flight-history-visible')) {
          document.getElementById('flightHistoryFlightsContainer').classList.toggle('flight-history-visible');
          document.getElementById('flightHistoryFlightList').innerHTML = '';
        }
          //document.getElementById("MapContainer").style.marginTop= "0";
      }

      function toggleDetails(element) {
        const flightItem = element.closest('.flight-item');
        const details = flightItem.querySelector('.flight-details');
        if (details.style.display === 'none' || details.style.display === '') {
          details.style.display = 'block';
        } else {
          details.style.display = 'none';
        }
      }

      function addFlight(flightName, route, origin, eta, aircraftType, airline, altitude, delayInfo, liveryId, fid, type) {
        altitude = numberWithCommas(Math.round(altitude)) + 'ft'
        if (type == 'in'){
          typetxt = 'ETA:'
        } else {
          typetxt = 'Sched.'
        }
        const flightList = document.getElementById('flight-list-'+type);
        // Create new flight item with passed variables
        const flightItem = document.createElement('div');
        flightItem.className = 'flight-item';
        flightItem.innerHTML = `
          <div class="flight-summary" onclick="toggleDetails(this)" style="text-align: left;">
            <div class="status-circle ${delayInfo === 'On Time' ? 'green' : 'orange'}"></div>
            <div class="flight-info">
              <span class="flight-name">${flightName}</span>
              <span class="flight-origin">${origin}</span>
              <span class="flight-eta">${typetxt} ${eta}</span>
            </div>
            <div class="arrow">&#x25BC;</div>
          </div>
          <div class="flight-details" style="display: none;">
            <img src="https://cdn.infiniteview.app/${liveryId}.jpg" onerror="this.onerror=null; this.src='https://cdn.infiniteview.app/unknown.jpg';" alt="Aircraft" loading="lazy" class="aircraft-image">
            <div class="details-info" style="text-align: left;">
              <div><strong>${aircraftType}</strong> (${airline})</div>
              <div>${route}</div>
              <div>${altitude}</div>
            </div>
            <button class="fly-button" onclick="redirectToMarker('${fid}')">Fly</button>
          </div>
        `;

        // Append the new flight to the list
        flightList.appendChild(flightItem);
      }


      function compare( a, b ) {
        if ( a.due < b.due ){
          return -1;
        }
        if ( a.due > b.due ){
          return 1;
        }
        return 0;
      }

      function destinationPoint(lat, lon, distance, bearing) {
          var radius = 6371e3; // (Mean) radius of earth

          var toRadians = function(v) { return v * Math.PI / 180; };
          var toDegrees = function(v) { return v * 180 / Math.PI; };

          // sinphi2 = sinphi1·cosDelta + cosphi1·sinDelta·costheta
          // tanDeltalambda = sintheta·sinDelta·cosphi1 / cosDelta−sinphi1·sinphi2
          // see mathforum.org/library/drmath/view/52049.html for derivation

          var Delta = Number(distance) / radius; // angular distance in radians
          var theta = toRadians(Number(bearing));

          var phi1 = toRadians(Number(lat));
          var lambda1 = toRadians(Number(lon));

          var sinphi1 = Math.sin(phi1), cosphi1 = Math.cos(phi1);
          var sinDelta = Math.sin(Delta), cosDelta = Math.cos(Delta);
          var sintheta = Math.sin(theta), costheta = Math.cos(theta);

          var sinphi2 = sinphi1*cosDelta + cosphi1*sinDelta*costheta;
          var phi2 = Math.asin(sinphi2);
          var y = sintheta * sinDelta * cosphi1;
          var x = cosDelta - sinphi1 * sinphi2;
          var lambda2 = lambda1 + Math.atan2(y, x);

          return [toDegrees(phi2), (toDegrees(lambda2)+540)%360-180]; // normalise to −180..+180°
      }

      function getDistanceFromLatLonInKm(lat1,lon1,lat2,lon2) {
        var R = 6371; // Radius of the earth in km
        var dLat = deg2rad(lat2-lat1);  // deg2rad below
        var dLon = deg2rad(lon2-lon1);
        var a =
          Math.sin(dLat/2) * Math.sin(dLat/2) +
          Math.cos(deg2rad(lat1)) * Math.cos(deg2rad(lat2)) *
          Math.sin(dLon/2) * Math.sin(dLon/2)
          ;
        var c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
        var d = R * c; // Distance in km
        return d;
      }

      function deg2rad(deg) {
        return deg * (Math.PI/180)
      }

      function numberWithCommas(x) {
        try{
          return x.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
        } catch(err){
          return '???'
        }
      }

      var LAST_WEB_REQUEST = Date.now()
      var takeoff_dict = {}                     //Must be global
      var landing_dict = {}                     //Must be global
      var dict = {}
      var active_atc = {}
      var atc_dict = {}
      var flight_dict = {}
      var all_flights_start_end = {}
      var name_flightid = {}
      var plane_markers = {}
      const FAVORITES_STORAGE_KEY = 'iv_favorite_flights'
      const FAVORITE_USERS_STORAGE_KEY = 'iv_favorite_users'
      const FRIEND_STORAGE_CONSENT_KEY = 'iv_friend_storage_consent'
      const MAX_SAVED_FLIGHTS = 12
      const MAX_SAVED_USERS = 50
      let favoriteFlights = []
      let favoriteUsers = []
      let friendStorageAllowed = false
      let currentSelectedFlight = null
      let pendingFavoriteTarget = null
      let favoritesStatusTimeout = null
      const planeDataLoadedForServer = {}

      function loadFavoriteFlights() {
        if (!friendStorageAllowed) {
          return []
        }
        try {
          const stored = localStorage.getItem(FAVORITES_STORAGE_KEY)
          const parsed = stored ? JSON.parse(stored) : []
          return Array.isArray(parsed) ? parsed : []
        } catch (error) {
          console.warn('Unable to load favorites', error)
          return []
        }
      }

      function saveFavoriteFlights() {
        if (!friendStorageAllowed) {
          return
        }
        try {
          localStorage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify(favoriteFlights))
        } catch (error) {
          console.warn('Unable to save favorites', error)
        }
      }

      function loadFavoriteUsers() {
        if (!friendStorageAllowed) {
          return []
        }
        try {
          const stored = localStorage.getItem(FAVORITE_USERS_STORAGE_KEY)
          const parsed = stored ? JSON.parse(stored) : []
          return Array.isArray(parsed) ? parsed : []
        } catch (error) {
          console.warn('Unable to load favorite users', error)
          return []
        }
      }

      function saveFavoriteUsers() {
        if (!friendStorageAllowed) {
          return
        }
        try {
          localStorage.setItem(FAVORITE_USERS_STORAGE_KEY, JSON.stringify(favoriteUsers))
        } catch (error) {
          console.warn('Unable to save favorite users', error)
        }
      }

      function mergeFavoriteFlightLists(current, stored) {
        const combined = Array.isArray(current) ? [...current] : []
        if (!Array.isArray(stored)) {
          return combined
        }
        const seen = new Set(combined.map(fav => `${fav.flightid}:${fav.server}`))
        stored.forEach(fav => {
          if (!fav || !fav.flightid || !fav.server) {
            return
          }
          const key = `${fav.flightid}:${fav.server}`
          if (!seen.has(key)) {
            combined.push(fav)
            seen.add(key)
          }
        })
        return combined.slice(0, MAX_SAVED_FLIGHTS)
      }

      function mergeFavoriteUserLists(current, stored) {
        const combined = Array.isArray(current) ? [...current] : []
        if (!Array.isArray(stored)) {
          return combined
        }
        const seen = new Set(combined.map(user => (user && user.username ? user.username.toLowerCase() : '')))
        stored.forEach(user => {
          if (!user || !user.username) {
            return
          }
          const normalized = user.username.toLowerCase()
          if (!seen.has(normalized)) {
            combined.push(user)
            seen.add(normalized)
          }
        })
        return combined.slice(0, MAX_SAVED_USERS)
      }

      function getServerMeta(id) {
        switch (id) {
          case 'ed323139-baa7-4834-b9d6-5fb9f19ff11e':
            return { short: 'Expert', letter: 'E' }
          case '15f884a5-52ec-467e-bda5-414d4569544d':
            return { short: 'Training', letter: 'T' }
          case '1f5ff830-8e4d-4477-89e7-21c136d54844':
            return { short: 'Casual', letter: 'C' }
          default:
            return { short: 'Live', letter: '?' }
        }
      }

      function setFavoritesStatus(message = '', duration = 0) {
        const statusEl = document.getElementById('favorites-status')
        if (!statusEl) return
        if (favoritesStatusTimeout) {
          clearTimeout(favoritesStatusTimeout)
          favoritesStatusTimeout = null
        }
        if (!message) {
          statusEl.style.display = 'none'
          statusEl.textContent = ''
          return
        }
        statusEl.style.display = 'block'
        statusEl.textContent = message
        if (duration > 0) {
          favoritesStatusTimeout = setTimeout(() => {
            statusEl.style.display = 'none'
            statusEl.textContent = ''
          }, duration)
        }
      }

      function getRouteLabel(flightId) {
        const start = outboundFlightsDict[flightId]
        const end = inboundFlightsDict[flightId]
        if (start || end) {
          return `${start || '????'} → ${end || '????'}`
        }
        return 'Route pending'
      }

      function updateFavoriteButtonState() {
        const button = document.getElementById('favorite-flight-button')
        if (!button) return
        if (!currentSelectedFlight) {
          button.disabled = true
          button.classList.remove('active')
          button.innerHTML = '☆'
          button.setAttribute('aria-pressed', 'false')
          return
        }
        button.disabled = false
        const exists = favoriteFlights.some(fav => fav.flightid === currentSelectedFlight.flightid && fav.server === currentSelectedFlight.server)
        button.classList.toggle('active', exists)
        button.innerHTML = exists ? '★' : '☆'
        button.setAttribute('aria-pressed', exists ? 'true' : 'false')
      }

      function renderFavoriteFlights() {
        const list = document.getElementById('favorites-list')
        const emptyState = document.getElementById('favorites-empty-state')
        const clearButton = document.getElementById('clearFavoritesButton')
        if (!list || !emptyState) return
        list.innerHTML = ''

        const hasFlights = favoriteFlights.length > 0

        if (!hasFlights) {
          emptyState.style.display = 'block'
          emptyState.textContent = 'Tap the ☆ button on a flight to pin it here.'
          if (clearButton) clearButton.style.display = 'none'
          return
        }

        if (clearButton) clearButton.style.display = 'inline-flex'

        emptyState.style.display = 'none'
        emptyState.textContent = 'Tap the ☆ button on a flight to pin it here.'

        let routesUpdated = false
        favoriteFlights.forEach(favorite => {
          const item = document.createElement('div')
          item.className = 'favorite-flight-item'
          const isLive = favorite.server === serverurl && plane_markers[favorite.flightid]
          if (isLive) {
            item.classList.add('live')
          }
          let routeLabel = favorite.route || 'Route pending'
          if (isLive) {
            const liveRoute = getRouteLabel(favorite.flightid)
            routeLabel = liveRoute
            if (liveRoute !== favorite.route) {
              favorite.route = liveRoute
              routesUpdated = true
            }
          }
          if (!favorite.username && plane_markers[favorite.flightid] && plane_markers[favorite.flightid].username) {
            favorite.username = plane_markers[favorite.flightid].username
            routesUpdated = true
          }
          const isFriend = favorite.username && isFavoriteUser(favorite.username)
          const friendIcon = isFriend ? `<span class="favorite-friend-icon" title="Friend"><i class="fa-solid fa-user-group" aria-hidden="true"></i></span>` : ''
          const usernameBadge = favorite.username ? `<div class="favorite-flight-username">${friendIcon}@${favorite.username}</div>` : ''
          item.innerHTML = `
            <div class="favorite-flight-info">
              ${usernameBadge}
              <div class="favorite-flight-title">${favorite.callsign || 'Unknown'}${favorite.aircraft ? ' · ' + favorite.aircraft : ''}</div>
              <div class="favorite-flight-route">${routeLabel}</div>
            </div>
            <div class="favorite-flight-meta">
              <span class="favorite-flight-tag">${getServerMeta(favorite.server).letter}</span>
              <button class="favorite-remove-button" title="Remove">×</button>
            </div>
          `
          item.addEventListener('click', () => handleFavoriteSelection(favorite))
          const removeBtn = item.querySelector('.favorite-remove-button')
          removeBtn.addEventListener('click', (event) => {
            event.stopPropagation()
            removeFavoriteFlight(favorite.flightid, favorite.server)
          })
          list.appendChild(item)
        })
        if (routesUpdated) {
          saveFavoriteFlights()
        }
      }

      function renderFavoriteUsers() {
        const list = document.getElementById('favorite-users-list')
        const emptyState = document.getElementById('favorite-users-empty')
        if (!list || !emptyState) return
        list.innerHTML = ''

        const hasUsers = favoriteUsers.length > 0
        const emptyMessage = friendStorageAllowed
          ? 'Add pilots to jump to them when they’re in the air.'
          : 'Enable local storage to keep your friends saved between visits.'

        if (!hasUsers) {
          emptyState.style.display = 'block'
          emptyState.textContent = emptyMessage
          return
        }

        emptyState.style.display = 'none'
        emptyState.textContent = emptyMessage

        favoriteUsers.forEach(user => {
          const item = document.createElement('div')
          item.className = 'favorite-user-item'
          item.innerHTML = `
            <span class="favorite-user-name">@${user.username}</span>
            <button class="favorite-remove-button" title="Remove" aria-label="Remove ${user.username}">×</button>
          `
          item.addEventListener('click', () => handleFavoriteUserSelection(user))
          const removeBtn = item.querySelector('.favorite-remove-button')
          if (removeBtn) {
            removeBtn.addEventListener('click', (event) => {
              event.stopPropagation()
              if (removeFavoriteUser(user.username)) {
                setFavoritesStatus(`${user.username} removed from friends.`, 2500)
              }
              configureFavoriteUserButton({ username: user.username, userid: user.userid })
            })
          }
          list.appendChild(item)
        })
      }

      function syncFavoriteFriendFlights() {
        if (!favoriteUsers.length) return false
        const activeFriendFlightMap = new Map()
        favoriteUsers.forEach(user => {
          const username = user.username
          if (!username) return
          const flightIds = name_flightid[username]
          if (!Array.isArray(flightIds)) return
          flightIds.forEach(flightId => {
            const marker = plane_markers[flightId]
            if (!marker) return
            const key = `${flightId}:${serverurl}`
            if (!activeFriendFlightMap.has(key)) {
              activeFriendFlightMap.set(key, marker)
            }
          })
        })

        let updated = false
        activeFriendFlightMap.forEach(marker => {
          const exists = favoriteFlights.some(fav => fav.flightid === marker.flightid && fav.server === serverurl)
          if (!exists) {
            const flightInfo = flight_dict && flight_dict[marker.flightid] ? flight_dict[marker.flightid] : null
            const flightHead = flightInfo && Array.isArray(flightInfo.head) ? flightInfo.head : []
            favoriteFlights.unshift({
              flightid: marker.flightid,
              callsign: flightHead[1] || marker.callsign || 'Unknown',
              airline: flightHead[3] || (flightInfo && flightInfo.airline) || marker.airline || '',
              aircraft: flightHead[2] || '',
              route: getRouteLabel(marker.flightid),
              server: serverurl,
              username: marker.username || '',
              autoFriend: true
            })
            updated = true
          }
        })

        if (favoriteFlights.length > MAX_SAVED_FLIGHTS) {
          favoriteFlights = favoriteFlights.slice(0, MAX_SAVED_FLIGHTS)
          updated = true
        }

        if (planeDataLoadedForServer[serverurl]) {
          const activeKeys = new Set(activeFriendFlightMap.keys())
          const filtered = favoriteFlights.filter(fav => {
            if (!fav.autoFriend || fav.server !== serverurl) return true
            const key = `${fav.flightid}:${fav.server}`
            if (activeKeys.has(key)) {
              return true
            }
            updated = true
            return false
          })
          if (filtered.length !== favoriteFlights.length) {
            favoriteFlights = filtered
          }
        }

        if (updated) {
          saveFavoriteFlights()
        }
        return updated
      }

      function toggleFavoriteFlight() {
        if (!currentSelectedFlight) return
        const idx = favoriteFlights.findIndex(fav => fav.flightid === currentSelectedFlight.flightid && fav.server === currentSelectedFlight.server)
        if (idx >= 0) {
          favoriteFlights.splice(idx, 1)
          setFavoritesStatus('Flight removed from saved list.', 2500)
        } else {
          favoriteFlights.unshift({
            ...currentSelectedFlight,
            savedAt: Date.now()
          })
          if (favoriteFlights.length > MAX_SAVED_FLIGHTS) {
            favoriteFlights = favoriteFlights.slice(0, MAX_SAVED_FLIGHTS)
          }
          setFavoritesStatus('Flight saved for quick access.', 2500)
        }
        saveFavoriteFlights()
        renderFavoriteFlights()
        updateFavoriteButtonState()
      }

      function removeFavoriteFlight(flightId, server) {
        favoriteFlights = favoriteFlights.filter(fav => !(fav.flightid === flightId && fav.server === server))
        saveFavoriteFlights()
        renderFavoriteFlights()
        updateFavoriteButtonState()
      }

      function clearFavoriteFlights() {
        favoriteFlights = []
        saveFavoriteFlights()
        renderFavoriteFlights()
        updateFavoriteButtonState()
        setFavoritesStatus('All saved flights cleared.', 3000)
      }

      function handleFavoriteSelection(favorite) {
        closeFavoritesPanel()
        if (favorite.server && favorite.server !== serverurl) {
          pendingFavoriteTarget = favorite.flightid
          setFavoritesStatus('Switching servers to find your saved flight…')
          changeServer(favorite.server)
          return
        }
        if (plane_markers[favorite.flightid]) {
          setFavoritesStatus('')
          redirectToMarker(favorite.flightid)
        } else {
          setFavoritesStatus('This flight is not currently live, but it will remain saved.')
        }
      }

      function handlePendingFavoriteFocus() {
        if (pendingFavoriteTarget && plane_markers[pendingFavoriteTarget]) {
          redirectToMarker(pendingFavoriteTarget)
          pendingFavoriteTarget = null
          setFavoritesStatus('')
        }
      }

      function toggleFavoritesPanel(forceState) {
        const panel = document.getElementById('favorites-popup')
        const button = document.getElementById('favorites-button')
        if (!panel || !button) return
        const shouldShow = typeof forceState === 'boolean' ? forceState : panel.classList.contains('hidden')
        panel.classList.toggle('hidden', !shouldShow)
        button.classList.toggle('active', shouldShow)
      }

      function closeFavoritesPanel() {
        toggleFavoritesPanel(false)
      }

      function initializeFavoritesFeature() {
        initializeFriendStorageConsent()
        favoriteFlights = loadFavoriteFlights()
        favoriteUsers = loadFavoriteUsers()
        renderFavoriteFlights()
        renderFavoriteUsers()
        updateFavoriteButtonState()
        configureFavoriteUserButton()
        const favoriteButton = document.getElementById('favorite-flight-button')
        if (favoriteButton) {
          favoriteButton.addEventListener('click', (event) => {
            event.preventDefault()
            toggleFavoriteFlight()
          })
        }
        const clearButton = document.getElementById('clearFavoritesButton')
        if (clearButton) {
          clearButton.addEventListener('click', (event) => {
            event.preventDefault()
            clearFavoriteFlights()
          })
        }
        const favoriteUserForm = document.getElementById('favorite-user-form')
        if (favoriteUserForm) {
          favoriteUserForm.addEventListener('submit', (event) => {
            event.preventDefault()
            const input = document.getElementById('favorite-user-input')
            if (!input) return
            const username = input.value.trim()
            if (!username) return
            const alreadySaved = isFavoriteUser(username)
            if (addFavoriteUser(username)) {
              setFavoritesStatus(alreadySaved ? `${username} is already in your friends list.` : `${username} added to friends.`, 2500)
              input.value = ''
            }
          })
        }
        const favoriteUserButton = document.getElementById('favorite-user-button')
        if (favoriteUserButton) {
          favoriteUserButton.style.display = 'none'
        }
      }

      function initializeFavoritesPanelControls() {
        const panel = document.getElementById('favorites-popup')
        const button = document.getElementById('favorites-button')
        if (!panel || !button) return

        document.addEventListener('click', (event) => {
          if (panel.classList.contains('hidden')) return
          if (!panel.contains(event.target) && !button.contains(event.target)) {
            closeFavoritesPanel()
          }
        })

        document.addEventListener('keydown', (event) => {
          if (event.key === 'Escape') {
            closeFavoritesPanel()
          }
        })
      }

      function initTrackerEnhancements() {
        initializeFavoritesFeature()
        initializeFavoritesPanelControls()
      }

      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initTrackerEnhancements)
      } else {
        initTrackerEnhancements()
      }
      var airport_markers = {}
      var flightpathlist = []
      var CURRENT_FLIGHT_DATA = {}
      var latlngs_dict = {}
      var NEED_TO_UPDATE = 'no'
      var inboundFlightsDict = {}
      var outboundFlightsDict = {}
      var rankedPlanes = []
      var rankedAirports = []
      var CURRENT_TRACK = ''
      var TO_UPDATE = 'no'
      var focusModeActive = false
      var focusFlightId = null
      var activeFlightDetailsId = null
      var globeflightid;
      var serverid;
      var globedelay;
      var planeFeatures = [];

      function isFocusedFlight(flightId) {
        return focusModeActive && focusFlightId === flightId;
      }

      function updateFocusButtonUI(currentFlightId) {
        const button = document.getElementById('focus-flight-button');
        if (!button) {
          return;
        }

        const flightId = currentFlightId || activeFlightDetailsId;
        const isFocused = isFocusedFlight(flightId);

        button.classList.toggle('active', !!isFocused);
        button.textContent = isFocused ? 'Show All' : 'Focus';
        button.setAttribute('aria-pressed', isFocused ? 'true' : 'false');
      }

      function setFocusMode(active, flightId) {
        if (active) {
          focusModeActive = true;
          focusFlightId = flightId;
        } else {
          focusModeActive = false;
          focusFlightId = null;
        }
        updateFocusButtonUI(flightId);
        applyFilters();
      }

      function configureFocusButton(flightId) {
        const button = document.getElementById('focus-flight-button');
        if (!button) {
          return;
        }

        activeFlightDetailsId = flightId;
        updateFocusButtonUI(flightId);

        button.onclick = function() {
          if (isFocusedFlight(flightId)) {
            setFocusMode(false);
          } else {
            setFocusMode(true, flightId);

            const feature = planeFeatures.find(feature => feature.properties && feature.properties.flightid === flightId);
            let coordinates = null;

            if (feature && feature.geometry && Array.isArray(feature.geometry.coordinates)) {
              coordinates = feature.geometry.coordinates;
            } else if (plane_markers[flightId] && plane_markers[flightId]._lngLat) {
              coordinates = [plane_markers[flightId]._lngLat.lng, plane_markers[flightId]._lngLat.lat];
            }

            if (coordinates && typeof map !== 'undefined') {
              try {
                map.flyTo({
                  center: coordinates,
                  zoom: Math.max(map.getZoom(), 6),
                  essential: false
                });
              } catch (err) {
                console.warn('Unable to adjust map focus for flight', flightId, err);
              }
            }
          }
        };
      }

      function showFriendStorageBanner() {
        const banner = document.getElementById('friend-storage-banner')
        if (banner) {
          banner.classList.remove('hidden')
        }
      }

      function hideFriendStorageBanner() {
        const banner = document.getElementById('friend-storage-banner')
        if (banner) {
          banner.classList.add('hidden')
        }
      }

      function setFriendStorageConsent(enabled, options = {}) {
        friendStorageAllowed = enabled
        const toggle = document.getElementById('friend-storage-toggle')
        if (toggle && toggle.checked !== enabled) {
          toggle.checked = enabled
        }
        if (enabled) {
          localStorage.setItem(FRIEND_STORAGE_CONSENT_KEY, 'granted')
          const storedFlights = loadFavoriteFlights()
          const storedUsers = loadFavoriteUsers()
          favoriteFlights = mergeFavoriteFlightLists(favoriteFlights, storedFlights)
          favoriteUsers = mergeFavoriteUserLists(favoriteUsers, storedUsers)
          saveFavoriteFlights()
          saveFavoriteUsers()
          renderFavoriteFlights()
          renderFavoriteUsers()
          updateFavoriteButtonState()
          syncFavoriteFriendFlights()
          if (options.announce) {
            setFavoritesStatus('Local storage enabled. Friends and followed flights will stay on this device.', 4000)
          }
        } else {
          localStorage.setItem(FRIEND_STORAGE_CONSENT_KEY, 'denied')
          localStorage.removeItem(FAVORITES_STORAGE_KEY)
          localStorage.removeItem(FAVORITE_USERS_STORAGE_KEY)
          renderFavoriteUsers()
          updateFavoriteButtonState()
          if (options.announce) {
            setFavoritesStatus('Local storage disabled. Friends and flights will only be kept for this session.', 4000)
          }
        }
      }

      function initializeFriendStorageConsent() {
        const storedPreference = localStorage.getItem(FRIEND_STORAGE_CONSENT_KEY)
        friendStorageAllowed = storedPreference === 'granted'
        if (storedPreference === 'denied') {
          localStorage.removeItem(FAVORITES_STORAGE_KEY)
          localStorage.removeItem(FAVORITE_USERS_STORAGE_KEY)
        }
        const toggle = document.getElementById('friend-storage-toggle')
        if (toggle) {
          toggle.checked = friendStorageAllowed
          toggle.addEventListener('change', (event) => {
            setFriendStorageConsent(event.target.checked, { announce: true })
          })
        }
        const dismissButton = document.getElementById('friend-storage-dismiss')
        if (dismissButton) {
          dismissButton.addEventListener('click', () => {
            if (!localStorage.getItem(FRIEND_STORAGE_CONSENT_KEY)) {
              localStorage.setItem(FRIEND_STORAGE_CONSENT_KEY, friendStorageAllowed ? 'granted' : 'denied')
            }
            hideFriendStorageBanner()
          })
        }
        const manageButton = document.getElementById('friend-storage-manage')
        if (manageButton) {
          manageButton.addEventListener('click', (event) => {
            event.preventDefault()
            showFriendStorageBanner()
          })
        }
        if (!storedPreference) {
          showFriendStorageBanner()
        }
      }

      function isFavoriteUser(username) {
        if (!username) return false
        const normalized = username.toLowerCase()
        return favoriteUsers.some(user => (user.username || '').toLowerCase() === normalized)
      }

      function addFavoriteUser(username, userId = null) {
        if (!username) return false
        const cleanName = username.trim()
        if (!cleanName) return false
        const normalized = cleanName.toLowerCase()
        const existingIndex = favoriteUsers.findIndex(user => (user.username || '').toLowerCase() === normalized)
        let existingEntry = {}
        if (existingIndex >= 0) {
          existingEntry = favoriteUsers[existingIndex]
          favoriteUsers.splice(existingIndex, 1)
        }
        favoriteUsers.unshift({
          username: cleanName,
          userid: userId || existingEntry.userid || null,
          addedAt: Date.now()
        })
        if (favoriteUsers.length > MAX_SAVED_USERS) {
          favoriteUsers = favoriteUsers.slice(0, MAX_SAVED_USERS)
        }
        saveFavoriteUsers()
        renderFavoriteUsers()
        const synced = syncFavoriteFriendFlights()
        if (synced) {
          renderFavoriteFlights()
        }
        return true
      }

      function removeFavoriteUser(username) {
        if (!username) return false
        const normalized = username.toLowerCase()
        const lengthBefore = favoriteUsers.length
        favoriteUsers = favoriteUsers.filter(user => (user.username || '').toLowerCase() !== normalized)
        if (lengthBefore === favoriteUsers.length) {
          return false
        }
        saveFavoriteUsers()
        renderFavoriteUsers()
        let needsRender = false
        let flightsUpdated = false
        favoriteFlights = favoriteFlights.filter(fav => {
          if (fav.autoFriend && (fav.username || '').toLowerCase() === normalized) {
            flightsUpdated = true
            return false
          }
          return true
        })
        if (flightsUpdated) {
          saveFavoriteFlights()
          needsRender = true
        }
        const synced = syncFavoriteFriendFlights()
        if (synced) {
          needsRender = true
        }
        if (needsRender) {
          renderFavoriteFlights()
        }
        return true
      }

      function toggleFavoriteUserFromProfile(username, userId) {
        if (!username) return
        if (isFavoriteUser(username)) {
          if (removeFavoriteUser(username)) {
            setFavoritesStatus(`${username} removed from friends.`, 2500)
          }
        } else if (addFavoriteUser(username, userId)) {
          setFavoritesStatus(`${username} added to friends.`, 2500)
        }
        configureFavoriteUserButton({ username, userid: userId })
      }

      function configureFavoriteUserButton(marker = null) {
        const button = document.getElementById('favorite-user-button')
        if (!button) return
        const username = marker && marker.username ? marker.username : ''
        const userId = marker && marker.userid ? marker.userid : ''
        if (!username) {
          button.style.display = 'none'
          button.classList.remove('active')
          button.textContent = '☆'
          button.title = 'Add friend'
          button.onclick = null
          return
        }
        button.style.display = 'flex'
        const isSaved = isFavoriteUser(username)
        button.classList.toggle('active', isSaved)
        button.textContent = isSaved ? '★' : '☆'
        button.title = isSaved ? 'Friend saved' : 'Add friend'
        button.onclick = (event) => {
          event.preventDefault()
          toggleFavoriteUserFromProfile(username, userId || null)
        }
      }

      function handleFavoriteUserSelection(user) {
        if (!user) return
        closeFavoritesPanel()
        if (user.username && name_flightid[user.username] && name_flightid[user.username].length) {
          const targetFlight = name_flightid[user.username].find(id => plane_markers[id])
          if (targetFlight) {
            redirectToMarker(targetFlight)
            setFavoritesStatus(`Jumped to ${user.username}'s flight.`)
            return
          }
        }
        if (user.userid) {
          window.open(`https://infiniteview.app/verify-flight?user=${user.userid}&name=${encodeURIComponent(user.username || 'Pilot')}`, '_blank')
          setFavoritesStatus(`Opened ${user.username}'s flight history.`, 3000)
        } else if (user.username) {
          setFavoritesStatus(`${user.username} isn't live right now, but we'll keep them in your friends list.`, 3000)
        }
      }

      var atc_frequency_convert = {0 :  "Ground",
                                   1 :  "Tower",
                                   2 :  "Unicom",
                                   3 :  "Clearance",
                                   4 :  "Approach",
                                   5 :  "Departure",
                                   6 :  "Center",
                                   7 :  "ATIS",
                                   8 :  "Aircraft",
                                   9 :  "Recorded",
                                   10:  "Unknown",
                                   11:  "Unused"}

      var flightline;
      var marker;
      var rankedAirports;
      var ifclick = "no"
      var serverurl = "ed323139-baa7-4834-b9d6-5fb9f19ff11e"
      var zoom = 3
      var lat = 0
      var line_colour = ""
      var index = 0;
      const sourceId = `line-${index}`;
      const layerId = `line-layer-${index}`;
      var long = 0
      var delayedForSearch = {}
      var check_lat = 0
      var check_long = 0
      var check_zoom = 3
      var strikes = 0
      var data = ""
      var xhr4 = ""
      var editFid = ''
      var CURRENT_MARKER = []
      var markerClicked = false;
      var wowza = false
      var downloadKey = 'twoplustwoisfour'
      var markerGroup = []
      var atcGroup = []
      var nonAtcGroup = []
      var flightpath = {}
      var PLANE_CONVERT = {"Airbus A318":"A318","Airbus A319":"A319","Airbus A320":"A320","Airbus A321":"A321","Airbus A330-200F":"A332F","Airbus A330-300":"A333","Airbus A330-900":"A339","Airbus A340-600":"A346","Airbus A350":"A359","Airbus A380":"A388","Boeing 717-200":"B712","Boeing 737-700":"B737","Boeing 737-800":"B738","Boeing 737-900":"B739","Boeing 737-8 MAX":"B38M","Boeing 747-200":"B742","Boeing 747-400":"B744","Boeing 747-8":"B748","Boeing 747-AF1":"VC25","Boeing 747-SCA":"B747SCA","Boeing 747-SOFIA":"SOFIA","Boeing 757-200":"B752","Boeing 767-300":"B763","Boeing 777-200ER":"B772","Boeing 777-200LR":"B77L","Boeing 777-300ER":"B77W","Boeing 777F":"B77F","Boeing 787-8":"B788","Boeing 787-9":"B789","Boeing 787-10":"B78X","Bombardier Dash 8-Q400":"DH8D","CRJ-200":"CRJ2","CRJ-700":"CRJ7","CRJ-900":"CRJ9","CRJ-1000":"CRJX","Cessna 172":"C172","Cessna 208":"C208","Challenger 350":"CL35","Cirrus SR22 GTS":"SR22","CubCrafters XCub":"XCUB","DC-10":"DC10","DC-10F":"DC10F","MD-11":"MD11","MD-11F":"MD11F","E175":"E75L","E190":"E190","A-10":"A10","AC-130":"AC130","C-130H":"C130H","C-130J":"C130J","C-130J-30":"C30J","C-17":"C17","F-14":"F14","F-16":"F16","F-22":"F22","F/A-18E Super Hornet":"FA18E","TBM-930":"TBM9","P-38":"P38","Spitfire":"SPIT","Space Shuttle":"SHUTTLE","Sleigh":"SLEIGH","TOP":"TOP","Unknown":"UNKN","Airbus A220-300":"BCS3"}

      // Map initialize

      //----------------------------------------------------------------------

      //show downtime window if necessary
      //document.getElementById('downtime-overlay').classList.add('active');
      document.getElementById('discord-overlay').classList.add('active');


            const isDarkMode = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
            let tbInstance = null;
            if (isDarkMode) {
                var s = 'mapbox://styles/mapbox/dark-v11'
            } else {
                var s = 'mapbox://styles/mapbox/streets-v9'
            }
            if (localStorage.getItem('mapProjection') == 'no'){
              projection = 'mercator'
            } else {
              projection = wowza ? localStorage.getItem('mapProjection') || 'mercator' : 'mercator'
            }

            if (projection == 'yes'){
              projection = 'mercator'
            }


            async function loadTracks() {
                try {
                    const response = await fetch('https://api.infiniteview.app/getTracks?apikey=ZNvNHJYC5IcLYUMlFpBI');
                    const natData = await response.json();

                    // Clear existing tracks and labels if they exist
                    if (map.getSource('nat-tracks')) {
                        // Remove all existing track layers
                        const layers = map.getStyle().layers;
                        layers.forEach(layer => {
                            if (layer.id.startsWith('track-')) {
                                map.removeLayer(layer.id);
                            }
                        });
                        if (map.getLayer('track-labels')) {
                            map.removeLayer('track-labels');
                        }

                        // Remove sources
                        map.removeSource('nat-tracks');
                        map.removeSource('nat-labels');
                    }

                    let features = [];
                    let labelFeatures = [];

                    // Function to create geodesic line between two points
                    function createGeodesicLine(start, end, steps = 100) {
                        const startPoint = turf.point(start);
                        const endPoint = turf.point(end);

                        // Create a great circle line
                        const greatCircle = turf.greatCircle(startPoint, endPoint, { npoints: steps });

                        return greatCircle.geometry.coordinates;
                    }

                    // Function to create geodesic path through multiple points
                    function createGeodesicPath(coordinates, steps = 100) {
                        if (coordinates.length < 2) return coordinates;

                        let geodesicCoordinates = [];

                        // Create geodesic segments between consecutive points
                        for (let i = 0; i < coordinates.length - 1; i++) {
                            const start = coordinates[i];
                            const end = coordinates[i + 1];

                            const segmentCoords = createGeodesicLine(start, end, steps);

                            // Add all coordinates except the last one to avoid duplicates
                            if (i === 0) {
                                geodesicCoordinates.push(...segmentCoords);
                            } else {
                                geodesicCoordinates.push(...segmentCoords.slice(1));
                            }
                        }

                        return geodesicCoordinates;
                    }

                    natData.result.forEach((track, index) => {
                        const coords = [];
                        for (const pt of track.path) {
                            const latlon = parseLatLon(pt);
                            if (latlon) {
                                coords.push([latlon[1], latlon[0]]); // [lon, lat]
                            }
                        }

                        if (coords.length >= 2) {
                            const color = colors[index % colors.length];
                            const trackName = track.name;

                            // Create geodesic coordinates
                            const geodesicCoords = createGeodesicPath(coords, 50); // 50 points per segment

                            // Track line with geodesic path
                            features.push({
                                type: "Feature",
                                geometry: {
                                    type: "LineString",
                                    coordinates: geodesicCoords
                                },
                                properties: {
                                    name: trackName,
                                    color: color
                                }
                            });

                            // Label positioning based on alphabet
                            const firstLetter = trackName[0].toUpperCase();
                            const isFirstHalf = firstLetter >= 'A' && firstLetter <= 'M';

                            let labelCoord = coords[0]; // Use original first coordinate for label
                            let textAnchor;

                            if (isFirstHalf) {
                                textAnchor = 'bottom-left'; // positions text to the right of the point
                            } else {
                                textAnchor = 'bottom-right'; // positions text to the left of the point
                            }

                            labelFeatures.push({
                                type: "Feature",
                                geometry: {
                                    type: "Point",
                                    coordinates: labelCoord
                                },
                                properties: {
                                    label: trackName,
                                    anchor: textAnchor,
                                    color: color // Add the track color to label properties
                                }
                            });
                        }
                    });

                    const trackCollection = {
                        type: "FeatureCollection",
                        features
                    };

                    const labels = {
                        type: "FeatureCollection",
                        features: labelFeatures
                    };

                    map.addSource('nat-tracks', {
                        type: 'geojson',
                        data: trackCollection
                    });

                    map.addSource('nat-labels', {
                        type: 'geojson',
                        data: labels
                    });

                    // Add track lines
                    features.forEach((feature, i) => {
                        map.addLayer({
                            id: `track-${i}`,
                            type: 'line',
                            source: 'nat-tracks',
                            filter: ['==', ['get', 'name'], feature.properties.name],
                            paint: {
                                'line-color': feature.properties.color,
                                'line-width': 2
                            }
                        });
                    });

                    // Add labels with zoom-responsive sizing and positioning
                    map.addLayer({
                        id: 'track-labels',
                        type: 'symbol',
                        source: 'nat-labels',
                        layout: {
                            'text-field': ['get', 'label'],
                            'text-size': [
                                'interpolate',
                                ['linear'],
                                ['zoom'],
                                8, 10,   // At zoom 8, use 10px
                                12, 12,  // At zoom 12, use 12px
                                16, 14   // At zoom 16, use 14px
                            ],
                            'text-font': ['Open Sans Semibold', 'Arial Unicode MS Bold'],
                            // Zoom-responsive offset - smaller values to reduce excessive offset
                            'text-offset': [
                                'interpolate',
                                ['linear'],
                                ['zoom'],
                                8, ['literal', [0, 0.2]],   // Very small offset at low zoom
                                12, ['literal', [0, 0.4]],  // Small offset at medium zoom
                                16, ['literal', [0, 0.6]]   // Moderate offset at high zoom
                            ],
                            'text-anchor': ['get', 'anchor'], // Use dynamic anchor from properties
                            'text-justify': 'center',
                            // Optional: Allow label overlap to prevent hiding
                            'text-allow-overlap': false,
                            'text-ignore-placement': false
                        },
                        paint: {
                            'text-color': '#ffffff', // White text for better contrast
                            'text-halo-color': ['get', 'color'], // Use track color as background box
                            'text-halo-width': [
                                'interpolate',
                                ['linear'],
                                ['zoom'],
                                8, 8,    // Larger halo at low zoom
                                12, 10,  // Medium halo at medium zoom
                                16, 12   // Larger halo at high zoom
                            ],
                            'text-halo-blur': 0 // Sharp edges for box effect
                        }
                    });

                    console.log('Tracks loaded successfully at', new Date().toLocaleString());

                } catch (error) {
                    console.error('Error loading tracks:', error);
                }
            }


            const colors = [
                '#5DA5A4', '#A4B494', '#D9BF77', '#7E8D85', '#9DABC0', '#B09FCA',
                '#C49292', '#A9A9A9', '#708090', '#6E7F80', '#7D8491', '#A89F91',
                '#8D91A0', '#ACB0BD', '#B6A68D'
            ];

            function parseLatLon(str) {
                const match = str.match(/^(\d+)[\/\\](\d+)$/);
                if (match) {
                    return [parseFloat(match[1]), -parseFloat(match[2])];
                }
                return null;
            }



            mapboxgl.accessToken = 'pk.eyJ1Ijoid2xhbWJlcm4iLCJhIjoiY200dHNhZzR0MGN1MzJ2cXl4cGw1OG41YyJ9.lRIK80CUJeBetWs5HatpUg';
            var map = new mapboxgl.Map({
                  container: 'MapContainer',
                  style: wowza ? localStorage.getItem('mapStyle') || s : s,
                  projection: projection,
                  zoom: 1,
                  center: [30, 15],
                  maxPitch: 60,
                  antialias: true
              });

              map.on('click', function(e) {

                  if (CURRENT_MARKER && CURRENT_MARKER.length > 1) {
                      if (CURRENT_MARKER[1].includes('plane') || CURRENT_MARKER[1].includes('santa')){
                          CURRENT_MARKER[0].getElement().children[0].style.backgroundImage = "url('./resources/"+CURRENT_MARKER[1]+".png')"
                      } else {
                        CURRENT_MARKER[0].getElement().style.backgroundImage = "url('./resources/"+CURRENT_MARKER[1]+".png')"
                      }
                  }

                  //removeAllLines()
                  markerClicked = false; // Reset flag after map click
                  if (!LOADING){
                    closeNav();
                  }
                  flightpathlist = []
                  if (map.getLayer('lines-layer')){
                    map.removeLayer('lines-layer')
                    map.removeSource('lines-source')

                    setTimeout(() => {
                        const markers = map.getContainer().querySelectorAll('.mapboxgl-marker');
                        markers.forEach(marker => {
                            marker.style.zIndex = '999999'; // Very high z-index
                            marker.style.pointerEvents = 'auto';
                        });

                        map.triggerRepaint();
                    }, 100);


                    // Remove the layer
                    map.removeLayer('flight-path-3d');
                  }else{
                    return true
                  }
              });

              map.on('moveend', () => {
                  const center = map.getCenter();
                  const zoom = map.getZoom();
                  const mapState = {
                      center: [center.lng, center.lat],
                      zoom: zoom
                  };
                  //localStorage.setItem('mapState', JSON.stringify(mapState));
              });

              map.on('load', () => {
                  const savedMapState = localStorage.getItem('mapState');
                  if (savedMapState) {
                      const mapState = JSON.parse(savedMapState);
                      setTimeout(() => {
                          map.setCenter(mapState.center);
                          map.setZoom(mapState.zoom);
                      }, 200); // Delay to ensure the map has fully rendered
                  }

                  // Load plane icon images
                  loadPlaneIcons();

                  loadTracks();

                  if (!(isMobile)){
                    map.addSource('mapbox-dem', {
                      type: 'raster-dem',
                      url: 'mapbox://mapbox.terrain-rgb',
                      tileSize: 512,
                      maxzoom: 14
                    });

                    // Enable the 3D terrain using the DEM source
                    map.setTerrain({ source: 'mapbox-dem', exaggeration: 1.5 });
                  }
                  // Handle missing images
                  map.on('styleimagemissing', (e) => {
                      const id = e.id;
                      console.log(`Loading missing image: ${id}`);

                      // Create a placeholder image for any missing icons
                      const width = 20;
                      const height = 20;
                      const data = new Uint8Array(width * height * 4);

                      // Fill with a bright color so it's visible for debugging
                      for (let i = 0; i < width * height; i++) {
                          data[i * 4 + 0] = 255; // R
                          data[i * 4 + 1] = 0;   // G
                          data[i * 4 + 2] = 255; // B
                          data[i * 4 + 3] = 255; // A
                      }

                      map.addImage(id, { width, height, data });
                  });

                  map.addSource('airports-source', {
                      type: 'geojson',
                      data: {
                          type: 'FeatureCollection',
                          features: []
                      }
                  });

                  map.addLayer({
                      id: 'airports-layer',
                      type: 'symbol',
                      source: 'airports-source',
                      layout: {
                          'icon-image': ['get', 'iconImage'],
                          'icon-size': 1,
                          'icon-allow-overlap': true,
                          'icon-ignore-placement': true
                      }
                  });

                  // Define displayPlaneDetails function in global scope
                  function displayPlaneDetails(e){
                    markerClicked = true
                    if (CURRENT_MARKER && CURRENT_MARKER.length > 1){
                      if (CURRENT_MARKER[1].includes('plane') || CURRENT_MARKER[1].includes('santa')){
                        CURRENT_MARKER[0].getElement().children[0].style.backgroundImage = "url('./resources/"+CURRENT_MARKER[1]+".png')"
                      } else {
                        CURRENT_MARKER[0].getElement().style.backgroundImage = "url('./resources/"+CURRENT_MARKER[1]+".png')"
                      }
                    }

                    exitReplayMode();
                    resetGraphContainer();

                    planeIcon = getPlaneIcon(e.username, e.aircraftId)

                    ifclick == 'yes'
                    TYPE = 'plane'
                    CURRENT_TRACK = e.flightid

                    if (focusModeActive && focusFlightId && focusFlightId !== e.flightid) {
                      focusFlightId = e.flightid;
                      applyFilters();
                    }

                    configureFocusButton(e.flightid)

                    //top boxes
                    document.getElementById('atisbox').style.display = 'none'
                    document.getElementById('1Box').style.display = 'none'
                    document.getElementById('2Box').style.display = 'none'
                    document.getElementById('flight-number').innerHTML = flight_dict[e.flightid]['head'][1]
                    document.getElementById('aircraft-type').innerHTML = PLANE_CONVERT[flight_dict[e.flightid]['head'][2]]
                    document.getElementById('airline-name').innerHTML = flight_dict[e.flightid]['head'][3]
                    currentSelectedFlight = {
                      flightid: e.flightid,
                      callsign: flight_dict[e.flightid]['head'][1],
                      airline: flight_dict[e.flightid]['head'][3],
                      aircraft: flight_dict[e.flightid]['head'][2],
                      route: getRouteLabel(e.flightid),
                      server: serverurl,
                      username: e.username || ''
                    }
                    updateFavoriteButtonState()
                    configureFavoriteUserButton(e)
                    //document.getElementById('1Title').innerHTML = flight_dict[e.flightid]['head'][0] + " (" + flight_dict[e.flightid]['head'][1] + ")"
                    //document.getElementById('1Text').innerHTML = flight_dict[e.flightid]['head'][2] + ' - ' + flight_dict[e.flightid]['head'][3]
                    //document.getElementById('2Box').innerHTML = '<span>Please ensure flightplan is correctly filed for route information.</span>'
                    if (e.title == 'Santa Claus'){
                      scheduledDeparture = 1735034400000
                      scheduledArrival = 1735128000000
                      actualDeparture = 1735034400000
                      predictedArrival = 1735128000000
                      progress = (Date.now() - 1735034400000)/(1735128000000 - 1735034400000) * 100
                      document.getElementById("2Box").innerHTML = "<span style='display:inline; float:left; line-height: 0.5em;'>&nbsp XMS<br><p style='font-size: 10px; color: #e5e5e5; margin-top: 10px;'>Actual (10:00 UTC)</p></span> <span style='display:inline; float:right; line-height: 0.5em;'> XMS&nbsp<br><p style='font-size: 10px; color: #e5e5e5; margin-top: 10px;'>Estimated (12:00 UTC)</p></span> <spanstyle='display:inline; line-height: 0.5em;'>⮕</span>  <br> <br> <div class='wrapper'><div class='progress-bar'><span class='progress-bar-inner' id='Pbar' style='width:"+progress+"%;'></span></div></div>"
                    }
                    // small boxes
                    document.getElementById('flight-info-panel').style.display = 'block'
                    document.getElementById('31Title').innerHTML = 'Altitude'
                    document.getElementById('31Title').style.color = '#e5e5e5'
                    document.getElementById('31Text').innerHTML = numberWithCommas(flight_dict[e.flightid]['text'][1]) + ' FT'
                    document.getElementById('32Title').innerHTML = 'VS'
                    document.getElementById('32Title').style.color = '#e5e5e5'
                    document.getElementById('32Text').innerHTML = numberWithCommas(flight_dict[e.flightid]['text'][2]) + " fpm"
                    document.getElementById('41Title').innerHTML = 'Heading'
                    document.getElementById('41Title').style.color = '#e5e5e5'
                    document.getElementById('41Text').innerHTML = flight_dict[e.flightid]['text'][3] + ' °'
                    document.getElementById('42Title').innerHTML = 'Ground Speed'
                    document.getElementById('42Title').style.color = '#e5e5e5'
                    document.getElementById('42Text').innerHTML = numberWithCommas(flight_dict[e.flightid]['text'][0]) + ' knots'
                    document.getElementById('51Title').innerHTML = 'ETA'
                    document.getElementById('51Title').style.color = '#e5e5e5'
                    document.getElementById('51Text').innerHTML = '??'
                    document.getElementById('51Text').style.color = '#FFF'
                    document.getElementById('52Title').innerHTML = 'Status'
                    document.getElementById('52Title').style.color = '#e5e5e5'
                    document.getElementById('52Text').innerHTML = '??'
                    document.getElementById('52Text').style.color = '#FFF'
                    resetGraphContainer()
                    document.getElementById('7box').innerHTML = '<span>Virtual Organisation</span><h2>'+flight_dict[e.flightid]['foot']+'</h2>'
                  }
                  window.displayPlaneDetails = displayPlaneDetails;

                  // Define markerOnClick function in global scope
                  let selectedFeatureId = null;
                  // Add click handlers for planes and airports
                  map.on('click', 'planes-layer', function(e) {
                      if (e.features.length > 0) {
                          const feature = e.features[0];
                          const props = feature.properties;
                          const id = feature.id;

                          // Unselect previously selected feature
                          if (selectedFeatureId !== null && selectedFeatureId !== id) {
                            map.setFeatureState(
                              { source: 'planes-source', id: selectedFeatureId },
                              { selected: false }
                            );
                          }
                          /*
                          const isCurrentlySelected = feature.state?.selected || false;

                          // Toggle the clicked feature
                          map.setFeatureState(
                            { source: 'planes-source', id },
                            { selected: !isCurrentlySelected }
                          );

                          selectedFeatureId = !isCurrentlySelected ? id : null;
                          */
                          // Create a temporary marker object to pass to existing functions
                          const marker = {
                              flightid: props.flightid,
                              title: props.title,
                              username: props.username,
                              callsign: props.callsign,
                              aircraftId: props.aircraftId,
                              speed: props.speed,
                              altitude: props.altitude,
                              userid: props.userid,
                              location: [props.lat, props.lng],
                              heading: props.heading,
                              timestamp: props.timestamp,
                              liveryId: props.liveryId,
                              pilotState: props.pilotState,
                              credit: props.credit,
                              _lngLat: { lat: props.lat, lng: props.lng },
                              getElement: function() {
                                  return {
                                      children: [{
                                          style: {
                                              backgroundImage: null
                                          }
                                      }],
                                      style: {
                                          backgroundImage: null
                                      }
                                  };
                              }
                          };

                          markerClicked = true;
                          displayPlaneDetails(marker);
                          markerOnClick(marker);
                      }
                  });

                  map.on('click', 'airports-layer', function(e) {
                      if (e.features.length > 0) {
                          const feature = e.features[0];
                          const props = feature.properties;

                          // Create a temporary marker object to pass to existing functions
                          const marker = {
                              title: props.icao,
                              _lngLat: { lat: props.lat, lng: props.lng },
                              getElement: function() {
                                  return {
                                      className: props.className,
                                      style: {
                                          backgroundImage: null
                                      }
                                  };
                              }
                          };

                          LOADING = true;
                          onAirportClick(marker);
                      }
                  });

                  // Change cursor when hovering over features
                  map.on('mouseenter', 'planes-layer', function() {
                      map.getCanvas().style.cursor = 'pointer';
                  });

                  map.on('mouseleave', 'planes-layer', function() {
                      map.getCanvas().style.cursor = '';
                  });

                  map.on('mouseenter', 'airports-layer', function() {
                      map.getCanvas().style.cursor = 'pointer';
                  });

                  map.on('mouseleave', 'airports-layer', function() {
                      map.getCanvas().style.cursor = '';
                  });

                  //flight(serverurl, true)
                  //airport(serverurl)
                  //addPolygon([[34.742469, 32.149800], [35.368796, 33.297498],[34.569388, 34.339991], [34.166769, 32.895804]]);
              });

              let currentFilters = [];
              let allPlanes = planeFeatures;
              let filteredPlanes = [...allPlanes];
              let selectedSuggestionIndex = -1;

              // Airline name mappings for fuzzy matching
              const airlineAliases = {
                  'american': ['american airlines', 'aa', 'aal'],
                  'delta': ['delta air lines', 'delta airlines', 'dl', 'dal'],
                  'united': ['united airlines', 'ua', 'ual'],
                  'southwest': ['southwest airlines', 'southwest air', 'sw', 'swa', 'luv'],
                  'jetblue': ['jetblue airways', 'jetblue airlines', 'b6', 'jbu'],
                  'alaska': ['alaska airlines', 'alaska air', 'as', 'asa'],
                  'spirit': ['spirit airlines', 'nk', 'spr'],
                  'frontier': ['frontier airlines', 'f9', 'fft'],
                  'allegiant': ['allegiant air', 'g4', 'aay']
              };

              // Create reverse mapping for quick lookup
              const aliasToAirline = {};
              Object.keys(airlineAliases).forEach(airline => {
                  airlineAliases[airline].forEach(alias => {
                      aliasToAirline[alias.toLowerCase()] = airline;
                  });
              });

              // Fuzzy string matching function with optimization
            function fuzzyMatch(needle, haystack, threshold = 0.9) {
              needle = needle.toLowerCase().trim();
              haystack = haystack.toLowerCase().trim();

              if (!needle || !haystack) return false;
              if (haystack.includes(needle)) return true;

              // Levenshtein distance calculation
              const matrix = Array(haystack.length + 1).fill().map(() => Array(needle.length + 1).fill(0));
              for (let i = 0; i <= haystack.length; i++) matrix[i][0] = i;
              for (let j = 0; j <= needle.length; j++) matrix[0][j] = j;

              for (let i = 1; i <= haystack.length; i++) {
                  for (let j = 1; j <= needle.length; j++) {
                      matrix[i][j] = haystack.charAt(i - 1) === needle.charAt(j - 1)
                          ? matrix[i - 1][j - 1]
                          : Math.min(
                              matrix[i - 1][j - 1] + 1,
                              matrix[i][j - 1] + 1,
                              matrix[i - 1][j] + 1
                          );
                  }
              }

              const distance = matrix[haystack.length][needle.length];
              return 1 - distance / Math.max(needle.length, haystack.length) >= threshold;
            }

            // Find best matching airline with case-insensitive handling
            function findMatchingAirline(input) {
              if (!input) return null;
              input = input.toLowerCase().trim();
              const airlines = [...new Set(allPlanes.map(p => p.properties.airline))];

              // Direct match
              for (const airline of airlines) {
                  if (airline.toLowerCase().includes(input)) {
                      return airline;
                  }
              }

              // Alias match
              for (const alias in aliasToAirline) {
                  if (alias.toLowerCase().includes(input) || input.includes(alias.toLowerCase())) {
                      const baseAirline = aliasToAirline[alias];
                      const matchedAirline = airlines.find(a =>
                          a.toLowerCase().includes(baseAirline.toLowerCase()) ||
                          fuzzyMatch(baseAirline, a, 0.8)
                      );
                      if (matchedAirline) return matchedAirline;
                  }
              }

              // Fuzzy match
              for (const airline of airlines) {
                  if (fuzzyMatch(input, airline, 0.8)) {
                      return airline;
                  }
              }

              return null;
            }

            // Highlight keywords in text
            function highlightKeywords(text, keywords) {
              if (!text || !keywords) return text;
              let highlighted = text;
              keywords.forEach(keyword => {
                  if (keyword) {
                      const regex = new RegExp(`(${keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
                      highlighted = highlighted.replace(regex, '<span class="keyword-highlight">$1</span>');
                  }
              });
              return highlighted;
            }

            function toggleFilter() {
              const panel = document.getElementById('filterPanel');
              panel.classList.toggle('active');
              if (panel.classList.contains('active')) {
                  document.getElementById('searchInput').focus();
              }
            }

            function parseNaturalLanguage(input) {
            if (!input) return { filters: [], detectedKeywords: [] };
            const filters = [];
            const text = input.toLowerCase().trim();
            const detectedKeywords = new Set();

            // Airline detection (existing code - no changes needed here)
            const isAirlineQuery = text.match(/^(airline\s+|carrier\s+)?([a-z\s]+)$/i) &&
                !text.includes('above') && !text.includes('below') &&
                !text.includes('to ') && !text.includes('from ') &&
                !text.includes('aircraft') && !text.includes('fl') &&
                !text.includes('altitude') && !text.includes('virtual');

            if (isAirlineQuery) {
                const words = text.split(/\s+/);
                for (let i = 0; i < words.length; i++) {
                    const word = words[i];
                    const twoWords = i < words.length - 1 ? `${word} ${words[i + 1]}` : '';
                    const threeWords = i < words.length - 2 ? `${word} ${words[i + 1]} ${words[i + 2]}` : '';

                    const matchedAirline = findMatchingAirline(threeWords) ||
                        findMatchingAirline(twoWords) ||
                        findMatchingAirline(word);

                    if (matchedAirline) {
                        filters.push({
                            type: 'airline',
                            value: matchedAirline,
                            display: `Airline: ${matchedAirline}`,
                            detectedFrom: matchedAirline.toLowerCase() !== word ? `"${word}"` : word
                        });
                        detectedKeywords.add(word);
                        break;
                    }
                }
            }

            // Aircraft type detection (existing code - no changes)
            const aircraftMatch = text.match(/(?:aircraft|plane|type|model)\s+([a-z0-9-]+)/i) ||
                text.match(/\b([a-z]\d{2,3}[a-z]*)\b/i) ||
                text.match(/\b(boeing|airbus|embraer|bombardier)\s+([a-z0-9-]+)/i);

            if (aircraftMatch) {
                let aircraftType = aircraftMatch[1];
                if (aircraftMatch[2]) aircraftType = aircraftMatch[2];
                aircraftType = aircraftType.toUpperCase();

                const aircraftTypes = [...new Set(allPlanes.map(p => p.properties.aircraftType || p.properties.aircraft))];
                const matchedType = aircraftTypes.find(type =>
                    type && (type.toUpperCase().includes(aircraftType) || aircraftType.includes(type.toUpperCase()))
                );

                if (matchedType) {
                    filters.push({
                        type: 'aircraft_type',
                        value: matchedType,
                        display: `Aircraft: ${matchedType}`,
                        detectedFrom: aircraftMatch[0]
                    });
                    detectedKeywords.add('aircraft').add(aircraftType.toLowerCase());
                }
            }

            // Virtual airline detection (existing code - no changes)
            const virtualAirlineMatch = text.match(/(?:virtual airline|va)\s+([a-z0-9]+)/i) ||
                text.match(/\b([a-z]{2,4}va)\b/i);

            if (virtualAirlineMatch) {
                const virtualAirline = virtualAirlineMatch[1].toUpperCase();
                const virtualAirlines = [...new Set(allPlanes.map(p => p.properties.virtualAirline).filter(Boolean))];

                if (virtualAirlines.includes(virtualAirline)) {
                    filters.push({
                        type: 'virtual_airline',
                        value: virtualAirline,
                        display: `Virtual Airline: ${virtualAirline}`,
                        detectedFrom: virtualAirlineMatch[0]
                    });
                    detectedKeywords.add('virtual').add('airline').add(virtualAirline.toLowerCase());
                }
            }

            // Status detection (existing code - no changes)
            if (text.includes('on time') || text.includes('on-time') || text.includes('punctual')) {
                filters.push({
                    type: 'status',
                    value: 'on_time',
                    display: 'Status: On Time',
                    detectedFrom: 'on time'
                });
                detectedKeywords.add('on').add('time');
            } else if (text.includes('delayed') || text.includes('late') || text.includes('behind schedule')) {
                filters.push({
                    type: 'status',
                    value: 'delayed',
                    display: 'Status: Delayed',
                    detectedFrom: 'delayed'
                });
                detectedKeywords.add('delayed');
            }

            // FIXED: Altitude detection - only add filters that are explicitly mentioned
            const flAbove = text.match(/(?:above|over|higher than|greater than|>\s*)fl\s*(\d+)/i);
            const flBelow = text.match(/(?:below|under|less than|lower than|<\s*)fl\s*(\d+)/i);
            const altitudeAbove = text.match(/(?:above|over|higher than|greater than|>\s*)(\d+)(?:\s*(?:feet|ft|foot))?/i);
            const altitudeBelow = text.match(/(?:below|under|less than|lower than|<\s*)(\d+)(?:\s*(?:feet|ft|foot))?/i);

            // Only add "above" filter if explicitly mentioned
            if (flAbove || altitudeAbove) {
                const altitude = flAbove ? parseInt(flAbove[1]) * 100 : parseInt(altitudeAbove[1]);
                filters.push({
                    type: 'altitude_min',
                    value: altitude,
                    display: `Above ${flAbove ? `FL${flAbove[1]}` : altitude.toLocaleString() + ' ft'}`,
                    detectedFrom: flAbove ? flAbove[0] : altitudeAbove[0]
                });
                detectedKeywords.add('above').add('altitude').add(flAbove ? flAbove[1] : altitude.toString());
            }

            // Only add "below" filter if explicitly mentioned
            if (flBelow || altitudeBelow) {
                const altitude = flBelow ? parseInt(flBelow[1]) * 100 : parseInt(altitudeBelow[1]);
                filters.push({
                    type: 'altitude_max',
                    value: altitude,
                    display: `Below ${flBelow ? `FL${flBelow[1]}` : altitude.toLocaleString() + ' ft'}`,
                    detectedFrom: flBelow ? flBelow[0] : altitudeBelow[0]
                });
                detectedKeywords.add('below').add('altitude').add(flBelow ? flBelow[1] : altitude.toString());
            }

            // Airport detection (existing code - no changes)
            const airports = [...new Set([...allPlanes.map(p => p.properties.destination), ...allPlanes.map(p => p.properties.origin)].filter(Boolean))];
            const toMatch = text.match(/(?:to|destination|arriving at|landing at|bound for)\s+([a-z]{4})/i);
            if (toMatch) {
                const airport = toMatch[1].toUpperCase();
                if (airports.includes(airport)) {
                    filters.push({
                        type: 'destination',
                        value: airport,
                        display: `To: ${airport}`,
                        detectedFrom: toMatch[0]
                    });
                    detectedKeywords.add('to').add(airport.toLowerCase());
                }
            }

            const fromMatch = text.match(/(?:from|origin|departing from|leaving from|outbound from)\s+([a-z]{4})/i);
            if (fromMatch) {
                const airport = fromMatch[1].toUpperCase();
                if (airports.includes(airport)) {
                    filters.push({
                        type: 'origin',
                        value: airport,
                        display: `From: ${airport}`,
                        detectedFrom: fromMatch[0]
                    });
                    detectedKeywords.add('from').add(airport.toLowerCase());
                }
            }

            return { filters, detectedKeywords: Array.from(detectedKeywords) };
            }

            function generateSuggestions(input) {
            const suggestions = new Set();
            if (!input || input.trim().length < 1) return Array.from(suggestions);

            const text = input.toLowerCase().trim();
            const { filters, detectedKeywords } = parseNaturalLanguage(text);

            // Only add 'detected' suggestion if there are multiple filters OR the input doesn't match any direct suggestions
            let hasDirectMatches = false;

            // Airline suggestions
            const airlines = [...new Set(allPlanes.map(p => p.properties.airline))];
            airlines.forEach(airline => {
                if (findMatchingAirline(text) === airline || airline.toLowerCase().includes(text)) {
                    const count = allPlanes.filter(p => p.properties.airline === airline).length;
                    suggestions.add({
                        type: 'airline',
                        text: airline,
                        display: `Airline: ${airline}`,
                        subtitle: `${count} flights`,
                        keywords: text.split(' ').filter(w => w.length >= 2)
                    });
                    hasDirectMatches = true;
                }
            });

            // Aircraft type suggestions
            const aircraftTypes = [...new Set(allPlanes.map(p => p.properties.aircraftType || p.properties.aircraft).filter(Boolean))];
            aircraftTypes.forEach(aircraft => {
                if (aircraft.toLowerCase().includes(text)) {
                    const count = allPlanes.filter(p => (p.properties.aircraftType || p.properties.aircraft) === aircraft).length;
                    suggestions.add({
                        type: 'aircraft',
                        text: `aircraft ${aircraft}`,
                        display: `Aircraft: ${aircraft}`,
                        subtitle: `${count} flights`,
                        keywords: [text, 'aircraft']
                    });
                    hasDirectMatches = true;
                }
            });

            // Virtual airline suggestions
            if (text.includes('virtual') || text.includes('va') || text.includes('vg') || text.includes('ifatc') || text.match(/[a-z]{2,4}va/i)) {
                const virtualAirlines = [...new Set(allPlanes.map(p => p.properties.virtualAirline).filter(Boolean))];
                virtualAirlines.forEach(va => {
                    if (va.toLowerCase().includes(text.replace(/virtual|airline/g, '').trim()) ||
                        text.includes(va.toLowerCase())) {
                        const count = allPlanes.filter(p => p.properties.virtualAirline === va).length;
                        suggestions.add({
                            type: 'virtual_airline',
                            text: `virtual airline ${va}`,
                            display: `Virtual Airline: ${va}`,
                            subtitle: `${count} flights`,
                            keywords: ['virtual', 'airline', va.toLowerCase()]
                        });
                        hasDirectMatches = true;
                    }
                });
            }

            // Status suggestions
            if (text.includes('on') || text.includes('time') || text.includes('punctual')) {
                const onTimeCount = allPlanes.filter(p => p.properties.status === 'on_time' || p.properties.onTime === true).length;
                if (onTimeCount > 0) {
                    suggestions.add({
                        type: 'status',
                        text: 'on time',
                        display: 'On Time Flights',
                        subtitle: `${onTimeCount} flights`,
                        keywords: ['on', 'time']
                    });
                    hasDirectMatches = true;
                }
            }

            if (text.includes('delay') || text.includes('late') || text.includes('behind')) {
                const delayedCount = allPlanes.filter(p => p.properties.status === 'delayed' || p.properties.delayed === true).length;
                if (delayedCount > 0) {
                    suggestions.add({
                        type: 'status',
                        text: 'delayed',
                        display: 'Delayed Flights',
                        subtitle: `${delayedCount} flights`,
                        keywords: ['delayed']
                    });
                    hasDirectMatches = true;
                }
            }

            // Airport suggestions
            const airports = [...new Set([...allPlanes.map(p => p.properties.destination), ...allPlanes.map(p => p.properties.origin)].filter(Boolean))];
            airports.forEach(airport => {
                if (airport.toLowerCase().includes(text) && text.length >= 2) {
                    const toCount = allPlanes.filter(p => p.properties.destination === airport).length;
                    const fromCount = allPlanes.filter(p => p.properties.origin === airport).length;

                    if (toCount > 0) {
                        suggestions.add({
                            type: 'destination',
                            text: `to ${airport}`,
                            display: `Flights to ${airport}`,
                            subtitle: `${toCount} flights`,
                            keywords: [text, 'to']
                        });
                        hasDirectMatches = true;
                    }

                    if (fromCount > 0) {
                        suggestions.add({
                            type: 'origin',
                            text: `from ${airport}`,
                            display: `Flights from ${airport}`,
                            subtitle: `${fromCount} flights`,
                            keywords: [text, 'from']
                        });
                        hasDirectMatches = true;
                    }
                }
            });

            // Altitude suggestions
            const altitudes = [15000, 20000, 25000, 30000, 35000, 40000];
            if (text.includes('above') || text.includes('over') || text.includes('high') || text.match(/>\s*\d/) || text.match(/FL\d+/i)) {
                const flMatch = text.match(/FL(\d+)/i);
                if (flMatch) {
                    const altitude = parseInt(flMatch[1]) * 100;
                    const count = allPlanes.filter(p => p.properties.altitude >= altitude).length;
                    if (count > 0) {
                        suggestions.add({
                            type: 'altitude_min',
                            text: `above ${altitude}`,
                            display: `Above FL${flMatch[1]} (${altitude.toLocaleString()} ft)`,
                            subtitle: `${count} flights`,
                            keywords: ['above', 'altitude', 'flight level', flMatch[1]]
                        });
                        hasDirectMatches = true;
                    }
                } else {
                    altitudes.forEach(alt => {
                        const count = allPlanes.filter(p => p.properties.altitude >= alt).length;
                        if (count > 0) {
                            suggestions.add({
                                type: 'altitude_min',
                                text: `above ${alt}`,
                                display: `Above FL${alt / 100} (${alt.toLocaleString()} ft)`,
                                subtitle: `${count} flights`,
                                keywords: ['above', 'altitude', 'flight level']
                            });
                            hasDirectMatches = true;
                        }
                    });
                }
            }

            if (text.includes('below') || text.includes('under') || text.includes('low') || text.match(/<\s*\d/) || text.match(/FL\d+/i)) {
                const flMatch = text.match(/FL(\d+)/i);
                if (flMatch) {
                    const altitude = parseInt(flMatch[1]) * 100;
                    const count = allPlanes.filter(p => p.properties.altitude <= altitude).length;
                    if (count > 0) {
                        suggestions.add({
                            type: 'altitude_max',
                            text: `below ${altitude}`,
                            display: `Below FL${flMatch[1]} (${altitude.toLocaleString()} ft)`,
                            subtitle: `${count} flights`,
                            keywords: ['below', 'altitude', 'flight level', flMatch[1]]
                        });
                        hasDirectMatches = true;
                    }
                } else {
                    altitudes.forEach(alt => {
                        const count = allPlanes.filter(p => p.properties.altitude <= alt).length;
                        if (count > 0) {
                            suggestions.add({
                                type: 'altitude_max',
                                text: `below ${alt}`,
                                display: `Below FL${alt / 100} (${alt.toLocaleString()} ft)`,
                                subtitle: `${count} flights`,
                                keywords: ['below', 'altitude', 'flight level']
                            });
                            hasDirectMatches = true;
                        }
                    });
                }
            }

            // Only add detected suggestion if we have filters and either no direct matches or multiple filters
            if (filters.length > 0 && (!hasDirectMatches || filters.length > 1)) {
                suggestions.add({
                    type: 'detected',
                    text: input,
                    display: 'Apply detected filters',
                    subtitle: filters.map(f => f.display).join(', '),
                    keywords: detectedKeywords
                });
            }

            return Array.from(suggestions).slice(0, 8);
            }

            function showSuggestions(suggestions) {
              const suggestionsEl = document.getElementById('suggestions');
              if (!suggestionsEl) return;

              if (suggestions.length === 0) {
                  suggestionsEl.classList.remove('active');
                  selectedSuggestionIndex = -1;
                  return;
              }

              suggestionsEl.innerHTML = suggestions.map((s, index) => {
                  const highlightedDisplay = s.keywords ?
                      highlightKeywords(s.display, s.keywords) : s.display;
                  const escapedText = s.text.replace(/'/g, "\\'").replace(/"/g, '\\"');
                  const escapedType = s.type.replace(/'/g, "\\'").replace(/"/g, '\\"');

                  return `<div class="suggestion-item ${index === selectedSuggestionIndex ? 'selected' : ''}"
                              onclick="applySuggestion('${escapedText}', '${escapedType}', '${s.display.replace(/'/g, "\\'")}')">
                      <div class="suggestion-content">
                          <div class="suggestion-title">${highlightedDisplay}</div>
                          ${s.subtitle ? `<div class="suggestion-detail">${s.subtitle}</div>` : ''}
                      </div>
                      <div class="suggestion-type">${s.type}</div>
                  </div>`;
              }).join('');

              suggestionsEl.classList.add('active');
            }

            function applySuggestion(text, type, display) {
            if (!text || !type) return;

            const searchInput = document.getElementById('searchInput');
            const suggestionsEl = document.getElementById('suggestions');
            if (suggestionsEl) suggestionsEl.classList.remove('active');
            selectedSuggestionIndex = -1;

            // Handle different suggestion types
            let filter = null;
            switch (type) {
                case 'airline':
                    // Use the actual airline name from the suggestion, not the search text
                    const airlineName = display.replace('Airline: ', '');
                    filter = {
                        type: 'airline',
                        value: airlineName,
                        display: `Airline: ${airlineName}`
                    };
                    break;
                case 'altitude_min':
                case 'altitude_max':
                    const match = text.match(/(\d+)/);
                    if (match) {
                        const altitude = parseInt(match[1]);
                        filter = {
                            type: type,
                            value: altitude,
                            display: type === 'altitude_min' ?
                                `Above ${altitude.toLocaleString()} ft` :
                                `Below ${altitude.toLocaleString()} ft`
                        };
                    }
                    break;
                case 'aircraft':
                    const aircraft = text.replace(/^aircraft\s+/i, '');
                    filter = {
                        type: 'aircraft_type',
                        value: aircraft,
                        display: `Aircraft: ${aircraft}`
                    };
                    break;
                case 'virtual_airline':
                    const va = text.replace(/^(virtual airline|va)\s+/i, '');
                    filter = {
                        type: 'virtual_airline',
                        value: va,
                        display: `Virtual Airline: ${va}`
                    };
                    break;
                case 'status':
                    filter = {
                        type: 'status',
                        value: text === 'on time' ? 'on_time' : 'delayed',
                        display: text === 'on time' ? 'Status: On Time' : 'Status: Delayed'
                    };
                    break;
                case 'destination':
                    const dest = text.replace(/^to\s+/i, '');
                    filter = {
                        type: 'destination',
                        value: dest,
                        display: `To: ${dest}`
                    };
                    break;
                case 'origin':
                    const origin = text.replace(/^from\s+/i, '');
                    filter = {
                        type: 'origin',
                        value: origin,
                        display: `From: ${origin}`
                    };
                    break;
                case 'detected':
                    // Process the original input for detected filters
                    const { filters } = parseNaturalLanguage(searchInput.value);
                    filters.forEach(detectedFilter => {
                        if (!currentFilters.some(f => f.type === detectedFilter.type && f.value === detectedFilter.value)) {
                            currentFilters.push(detectedFilter);
                        }
                    });
                    searchInput.value = '';  // Clear after processing
                    updateFilterTags();
                    applyFilters();
                    return;
            }

            if (filter && !currentFilters.some(f => f.type === filter.type && f.value === filter.value)) {
                currentFilters.push(filter);
                updateFilterTags();
                applyFilters();
            }

            searchInput.value = '';  // Clear input after applying filter
            }

            function processInput() {
              const input = document.getElementById('searchInput');
              if (!input || !input.value.trim()) return;

              const { filters } = parseNaturalLanguage(input.value);
              filters.forEach(filter => {
                  if (!currentFilters.some(f => f.type === filter.type && f.value === filter.value)) {
                      currentFilters.push(filter);
                  }
              });

              updateFilterTags();
              input.value = '';
              const suggestionsEl = document.getElementById('suggestions');
              if (suggestionsEl) suggestionsEl.classList.remove('active');
              selectedSuggestionIndex = -1;
              applyFilters();
            }

            function updateFilterTags() {
              const tagsEl = document.getElementById('filterTags');
              if (!tagsEl) return;

              tagsEl.innerHTML = currentFilters.map((filter, index) =>
                  `<div class="filter-tag">
                      ${filter.display}
                      <span class="remove" onclick="removeFilter(${index})">×</span>
                  </div>`
              ).join('');

              const countEl = document.getElementById('filter-count');
              if (countEl) {
                  countEl.textContent = currentFilters.length;
                  countEl.style.display = currentFilters.length > 0 ? 'inline' : 'none';
              }
            }

            function removeFilter(index) {
              currentFilters.splice(index, 1);
              updateFilterTags();
              applyFilters();
            }

            function applyFilters() {
              let baseFeatures = planeFeatures;

              if (focusModeActive && focusFlightId) {
                  baseFeatures = planeFeatures.filter(feature => feature.properties && feature.properties.flightid === focusFlightId);

                  if (baseFeatures.length === 0) {
                      focusModeActive = false;
                      focusFlightId = null;
                      updateFocusButtonUI();
                      baseFeatures = planeFeatures;
                  }
              }

              let filteredPlanes;

              if (focusModeActive && focusFlightId) {
                  filteredPlanes = baseFeatures;
              } else {
                  filteredPlanes = baseFeatures.filter(feature => {
                      return currentFilters.every(filter => {
                          const props = feature.properties || {};
                          switch (filter.type) {
                              case 'airline':
                                  return props.airline === filter.value;
                              case 'aircraft_type':
                                  return (props.aircraftType || props.aircraft) === filter.value;
                              case 'virtual_airline':
                                  return props.virtualAirline === filter.value;
                              case 'status':
                                  return filter.value === 'on_time' ?
                                      (props.status === 'on_time' || props.onTime === true) :
                                      (props.status === 'delayed' || props.delayed === true);
                              case 'altitude_min':
                                  return props.altitude >= filter.value;
                              case 'altitude_max':
                                  return props.altitude <= filter.value;
                              case 'destination':
                                  return props.destination === filter.value;
                              case 'origin':
                                  return props.origin === filter.value;
                              default:
                                  return true;
                          }
                      });
                  });
              }

              const source = map.getSource('planes-source');
              if (source) {
                  source.setData({
                      type: 'FeatureCollection',
                      features: filteredPlanes
                  });
              }

              const statusText = document.getElementById('statusText');
              if (statusText) {
                  if (focusModeActive && focusFlightId) {
                      statusText.textContent = 'Focusing on 1 flight';
                  } else {
                      statusText.textContent = `Showing ${filteredPlanes.length} of ${planeFeatures.length} planes`;
                  }
              }
            }

            function clearFilters() {
              currentFilters = [];
              updateFilterTags();
              applyFilters();
            }
            // Event listeners
            document.getElementById('searchInput').addEventListener('input', function(e) {
                const suggestions = generateSuggestions(e.target.value);
                showSuggestions(suggestions);
            });

            document.getElementById('searchInput').addEventListener('keydown', function(e) {
                const suggestionsEl = document.getElementById('suggestions');
                const suggestions = suggestionsEl.querySelectorAll('.suggestion-item');

                if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    selectedSuggestionIndex = Math.min(selectedSuggestionIndex + 1, suggestions.length - 1);
                    updateSuggestionSelection();
                } else if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    selectedSuggestionIndex = Math.max(selectedSuggestionIndex - 1, -1);
                    updateSuggestionSelection();
                } else if (e.key === 'Enter') {
                    e.preventDefault();
                    if (selectedSuggestionIndex >= 0 && suggestions[selectedSuggestionIndex]) {
                        suggestions[selectedSuggestionIndex].click();
                    } else {
                        processInput();
                    }
                } else if (e.key === 'Escape') {
                    suggestionsEl.classList.remove('active');
                    selectedSuggestionIndex = -1;
                }
            });

            function updateSuggestionSelection() {
                const suggestions = document.querySelectorAll('.suggestion-item');
                suggestions.forEach((item, index) => {
                    item.classList.toggle('selected', index === selectedSuggestionIndex);
                });

                // Scroll selected item into view
                if (selectedSuggestionIndex >= 0 && suggestions[selectedSuggestionIndex]) {
                    suggestions[selectedSuggestionIndex].scrollIntoView({
                        block: 'nearest',
                        behavior: 'smooth'
                    });
                }
            }

            // Close suggestions when clicking outside
            document.addEventListener('click', function(e) {
                if (!e.target.closest('.filter-panel')) {
                    document.getElementById('suggestions').classList.remove('active');
                }
            });


            var waypoints = [];

            function formatCoordinateCompact(coord, isLongitude = false) {
                const abs = Math.abs(coord);
                const deg = Math.floor(abs);
                const min = ((abs - deg) * 60).toFixed(1);
                const dir = coord >= 0 ? (isLongitude ? 'E' : 'N') : (isLongitude ? 'W' : 'S');
                return `${deg}°${min}'${dir}`;
            }

            function formatAltitudeCompact(alt) {
               if (alt >= 1000) {
                   return `${Math.round(alt/1000)}k ft`;
               }
               return `${Math.round(alt)} ft`;
            }

            function groupWaypointsByProcedure(waypoints) {
                const grouped = {};
                const ungrouped = [];

                waypoints.forEach(waypoint => {
                    if (waypoint.procedure && waypoint.procedure !== false) {
                        const procedure = waypoint.procedure;
                        if (!grouped[procedure]) {
                            grouped[procedure] = [];
                        }
                        grouped[procedure].push(waypoint);
                    } else {
                        ungrouped.push(waypoint);
                    }
                });

                return { grouped, ungrouped };
            }

            function renderWaypoints() {
                const container = document.getElementById('waypoints-container');
                const { grouped, ungrouped } = groupWaypointsByProcedure(waypoints);

                // Update stats
                document.getElementById('total-waypoints').textContent = waypoints.length;

                let html = '';
                let currentIndex = 0;

                // Process waypoints in chronological order
                while (currentIndex < waypoints.length) {
                    const waypoint = waypoints[currentIndex];

                    if (waypoint.procedure && waypoint.procedure !== false) {
                        // This is part of a procedure - render the entire procedure group
                        const procedure = waypoint.procedure;
                        const procedureWaypoints = grouped[procedure];

                        html += `
                            <div class="procedure-group collapsed">
                                <div class="procedure-header" onclick="toggleProcedure(this)">
                                    <div class="procedure-title">
                                        <span class="procedure-count">${procedureWaypoints.length}</span>
                                        ${procedure}
                                    </div>
                                    <span class="procedure-chevron">▼</span>
                                </div>
                                <div class="waypoints">
                        `;

                        procedureWaypoints.forEach((procWaypoint, index) => {
                            html += `
                                <div class="waypoint" onclick="toggleWaypoint(this)" style='background: rgba(59, 130, 246, 0.08);'>
                                    <div class="waypoint-header">
                                        <div>
                                            <div class="waypoint-name">${procWaypoint.name}</div>
                                            <div class="waypoint-preview">${formatCoordinateCompact(procWaypoint.latitude)}, ${formatCoordinateCompact(procWaypoint.longitude, true)} • ${formatAltitudeCompact(procWaypoint.altitude)}</div>
                                        </div>
                                    </div>

                                </div>
                            `;
                        });

                        html += `
                                </div>
                            </div>
                        `;

                        // Skip ahead past all waypoints in this procedure
                        while (currentIndex < waypoints.length &&
                               waypoints[currentIndex].procedure === procedure) {
                            currentIndex++;
                        }
                    } else {
                        // This is a standalone waypoint
                        html += `
                            <div class="waypoint standalone" onclick="toggleWaypoint(this)">
                                <div class="waypoint-header">
                                    <div>
                                        <div class="waypoint-name">${waypoint.name}</div>
                                        <div class="waypoint-preview">${formatCoordinateCompact(waypoint.latitude)}, ${formatCoordinateCompact(waypoint.longitude, true)} • ${formatAltitudeCompact(waypoint.altitude)}</div>
                                    </div>
                                </div>
                            </div>
                        `;
                        currentIndex++;
                    }
                }

                container.innerHTML = html;
            }

            function toggleWidget() {
                const widget = document.getElementById('waypoints-widget');
                widget.classList.toggle('collapsed');
            }

            function toggleProcedure(element) {
                const group = element.closest('.procedure-group');
                group.classList.toggle('collapsed');
            }

            function toggleWaypoint(element) {
                element.classList.toggle('expanded');
            }

            function expandAll() {
                document.querySelectorAll('.procedure-group').forEach(group => {
                    group.classList.remove('collapsed');
                });
                document.querySelectorAll('.waypoint').forEach(waypoint => {
                    waypoint.classList.add('expanded');
                });
            }

            function collapseAll() {
                document.querySelectorAll('.procedure-group').forEach(group => {
                    group.classList.add('collapsed');
                });
                document.querySelectorAll('.waypoint').forEach(waypoint => {
                    waypoint.classList.remove('expanded');
                });
            }


              function clearAllPolygons() {
                // Reset the global FeatureCollections.
                window.allPolygons = { type: "FeatureCollection", features: [] };
                window.allCircles = { type: "FeatureCollection", features: [] };

                // If the polygon source exists, update its data to be empty.
                if (map.getSource("polygons")) {
                  map.getSource("polygons").setData(window.allPolygons);
                }

                // Similarly, update the circles source if it exists.
                if (map.getSource("circles")) {
                  map.getSource("circles").setData(window.allCircles);
                }

                console.log("All polygons and circles have been cleared from the map.");
              }

              function waitForMapToLoad(callback) {
                  if (map.isStyleLoaded()) {
                      callback();
                  } else {
                      setTimeout(() => waitForMapToLoad(callback), 500); // Check every 500ms
                  }
              }

              function addPolygon(coords, eventType, label) {
                waitForMapToLoad(() => {
                  console.log("Map is loaded! Adding new polygon...");

                  // Create (or reuse) global FeatureCollections for polygons and circles.
                  window.allPolygons = window.allPolygons || { type: "FeatureCollection", features: [] };
                  window.allCircles = window.allCircles || { type: "FeatureCollection", features: [] };

                  // Convert input coordinates (assumed to have .longitude and .latitude) to [lng, lat] pairs.
                  const polygonCoords = coords.map(coord => [coord.longitude, coord.latitude]);
                  const isCircle = polygonCoords.length === 1;
                  let polygonFeature, circleFeature;

                  // Determine fill color and opacity based on event type (case-insensitive).
                  let fillColor, fillOpacity;
                  if (eventType.toLowerCase() === "weather") {
                    fillColor = "#0000FF"; // Blue for Weather
                    fillOpacity = 0.1;
                  } else if (eventType.toLowerCase() === "community event") {
                    fillColor = "#FF0000"; // Red for Community Event
                    fillOpacity = 0.1;
                  } else {
                    fillColor = "#808080"; // Default grey
                    fillOpacity = 0.1;
                  }

                  if (isCircle) {
                    const [lng, lat] = polygonCoords[0];
                    // For the polygon layer, create a turf circle (15 km radius).
                    polygonFeature = turf.circle([lng, lat], 15, { steps: 64, units: "kilometers" });
                    // Add styling and popup properties to the feature.
                    polygonFeature.properties.fillColor = fillColor;
                    polygonFeature.properties.fillOpacity = fillOpacity;
                    polygonFeature.properties.popupContent = label;

                    // Create a simple point feature for the circle outline.
                    circleFeature = {
                      type: "Feature",
                      geometry: {
                        type: "Point",
                        coordinates: [lng, lat]
                      },
                      properties: {
                        popupContent: label
                      }
                    };
                  } else {
                    // Ensure the polygon is closed by repeating the first coordinate if needed.
                    if (polygonCoords.length > 0) {
                      const firstCoord = polygonCoords[0];
                      const lastCoord = polygonCoords[polygonCoords.length - 1];
                      if (firstCoord[0] !== lastCoord[0] || firstCoord[1] !== lastCoord[1]) {
                        polygonCoords.push(firstCoord);
                      }
                    }
                    polygonFeature = {
                      type: "Feature",
                      geometry: {
                        type: "Polygon",
                        coordinates: [polygonCoords]
                      },
                      properties: {
                        fillColor: fillColor,
                        fillOpacity: fillOpacity,
                        popupContent: label
                      }
                    };
                  }

                  // Add the new polygon feature to the global polygons FeatureCollection.
                  window.allPolygons.features.push(polygonFeature);

                  // Update (or create) the polygons source and layer.
                  if (map.getSource("polygons")) {
                    map.getSource("polygons").setData(window.allPolygons);
                  } else {
                    map.addSource("polygons", {
                      type: "geojson",
                      data: window.allPolygons
                    });
                    map.addLayer({
                      id: "polygons",
                      type: "fill",
                      source: "polygons",
                      paint: {
                        "fill-color": ["get", "fillColor"],
                        "fill-opacity": ["get", "fillOpacity"],
                        "fill-outline-color": "#000000"
                      }
                    });
                  }

                  // If this is a circle, update (or create) the circles source and layer.
                  if (isCircle) {
                    window.allCircles.features.push(circleFeature);
                    if (map.getSource("circles")) {
                      map.getSource("circles").setData(window.allCircles);
                    } else {
                      map.addSource("circles", {
                        type: "geojson",
                        data: window.allCircles
                      });
                      map.addLayer({
                        id: "circles",
                        type: "circle",
                        source: "circles",
                        paint: {
                          "circle-radius": 10,                        // constant pixel radius
                          "circle-color": "rgba(0,0,0,0)",              // transparent fill
                          "circle-stroke-color": "#FF0000",             // red outline
                          "circle-stroke-width": 2,
                          "circle-stroke-opacity": 1
                        }
                      });
                    }
                  }

                  // Attach popup event handlers (if not already attached) for both layers.
                  if (!map._popupsAttached) {
                    // For polygons layer:
                    map.on("click", "polygons", function(e) {
                      if (e.features.length) {
                        new mapboxgl.Popup()
                          .setLngLat(e.lngLat)
                          .setHTML(e.features[0].properties.popupContent)
                          .addTo(map);
                      }
                    });
                    // For circles layer:
                    map.on("click", "circles", function(e) {
                      if (e.features.length) {
                        new mapboxgl.Popup()
                          .setLngLat(e.lngLat)
                          .setHTML(e.features[0].properties.popupContent)
                          .addTo(map);
                      }
                    });
                    // Change cursor to pointer on hover.
                    map.on("mouseenter", "polygons", () => { map.getCanvas().style.cursor = "pointer"; });
                    map.on("mouseleave", "polygons", () => { map.getCanvas().style.cursor = ""; });
                    map.on("mouseenter", "circles", () => { map.getCanvas().style.cursor = "pointer"; });
                    map.on("mouseleave", "circles", () => { map.getCanvas().style.cursor = ""; });
                    map._popupsAttached = true;
                  }

                  console.log("New polygon (and circle, if applicable) added. Total polygons:", window.allPolygons.features.length);
                });
              }



              function changeServer(server){
                if (Date.now() - LAST_WEB_REQUEST > 1000){
                  closeNav()
                  serverurl = server
                  LAST_WEB_REQUEST = Date.now()
                  flight(server)
                  airport(server)
                  if (server == 'ed323139-baa7-4834-b9d6-5fb9f19ff11e'){
                    document.getElementById('serverdropdown').innerHTML = 'E'
                  } else if (server == '15f884a5-52ec-467e-bda5-414d4569544d'){
                    document.getElementById('serverdropdown').innerHTML = 'T'
                  } else{
                    document.getElementById('serverdropdown').innerHTML = 'C'
                  }
                }
              }

              function redirectToMarker(data){
                if (data.includes('Airport') == false && data.length > 4){
                  // this is a plane
                  plane = plane_markers[data]
                  map.flyTo({
                      center: [plane._lngLat['lng'], plane._lngLat['lat']],
                      zoom: (plane.altitude >= 30000) ? 4 : 10,
                      speed: 1.2,
                      curve: 1.42,
                      easing: (t) => t,
                      essential: true
                  });
                  // Instead of trying to click the element, directly call the functions
                  // that would be triggered by a click on the plane layer
                  markerClicked = true;
                  displayPlaneDetails(plane);
                  markerOnClick(plane);
                } else {
                  aport = airport_markers[data]
                  map.flyTo({
                      center: [aport._lngLat['lng'], aport._lngLat['lat']],
                      zoom: 10,
                      speed: 1.2,
                      curve: 1.42,
                      easing: (t) => t,
                      essential: true
                  });
                  aport.getElement().click()
                }
                document.getElementById('search-results').style.display = 'none';
                filteredTerms = []
              }

              // Function to get altitude thresholds based on zoom level
              function getAltitudeThresholds(zoom) {
                // For debugging: temporarily show all planes at all zoom levels
                return { min: 0, max: Infinity };

                // At zoom level <= 3 (very zoomed out): Show planes at higher altitudes
                // As zoom increases: Progressively show lower altitude flights
                // At zoom level >= 7 (reasonably zoomed in): Show all planes

                /*
                const minZoom = 3;
                const maxZoom = 7;

                if (zoom <= minZoom) {
                  // When fully zoomed out, show planes above 28,000ft (FL280)
                  return { min: 28000, max: Infinity };
                } else if (zoom >= maxZoom) {
                  // When zoomed in, show all planes
                  return { min: 0, max: Infinity };
                } else {
                  // Linear interpolation between zoom levels
                  const zoomRatio = (zoom - minZoom) / (maxZoom - minZoom);

                  // As we zoom in, gradually lower the minimum altitude threshold
                  // Start at 28,000ft when zoomed out and go down to 0ft when zoomed in
                  const minAlt = Math.max(0, 28000 * (1 - zoomRatio));

                  return { min: minAlt, max: Infinity };
                }
                */
              }

              // Function to load all plane icon images
              function loadPlaneIcons() {
                const iconTypes = [
                    'testplaneicon',
                    'testspecialplaneicon',
                    'testinfinitespecialplaneicon',
                    'testplaneicon380',
                    'testplaneiconjumbo',
                    'testplaneicona350',
                    'testplaneicon777',
                    'testplaneicon727',
                    'testplaneiconga',
                    'testplaneiconclicked',
                    'testplaneicon380clicked',
                    'testplaneiconjumboclicked',
                    'testplaneicona350clicked',
                    'testplaneicon777clicked',
                    'testplaneicon727clicked',
                    'testplaneicongaclicked',
                    'testspecialplaneicon380',
                    'testspecialplaneicona350',
                    'testspecialplaneicon777',
                    'testspecialplaneicon727',
                    'testspecialplaneiconga',
                    'testspecialplaneiconjumbo',
                    'testinfinitespecialplaneicon380',
                    'testinfinitespecialplaneicona350',
                    'testinfinitespecialplaneicon777',
                    'testinfinitespecialplaneiconga',
                    'testinfinitespecialplaneicon727',
                    'testinfinitespecialplaneiconjumbo',
                    'santaicon'
                ];

                iconTypes.forEach(iconName => {
                    // Only load if image doesn't already exist on the map
                    if (!map.hasImage(iconName)) {
                        loadImage(iconName);
                    }
                });

                function loadImage(iconName, width=30, height=35) {
                    const img = new Image();
                    img.onload = () => {
                        // Double-check before adding in case it was loaded elsewhere
                        if (!map.hasImage(iconName)) {
                            map.addImage(iconName, img, {width: width, height: height});
                        }
                    };
                    img.onerror = () => {
                        console.error(`Failed to load image: ${iconName}`);
                    };
                    img.src = `./resources/${iconName}.png`;
                }
              }

              function updatePlaneVisibility() {
                const zoom = map.getZoom();

                // Also handle the existing non-ATC markers visibility logic
                if (zoom < 7) {
                  nonAtcGroup.forEach(marker => marker.getElement().style.display = 'none');
                } else {
                  nonAtcGroup.forEach(marker => marker.getElement().style.display = 'block');
                }
              }

              map.on('zoomend', function(){
                updatePlaneVisibility();
              })


              map.addControl(new mapboxgl.NavigationControl({
                showCompass: true,
                showZoom: false
              }), 'bottom-right');

              var myLineChart;
              var graphPoints = [];
              var chartPoints = [];
              var graphContainerTemplate = document.getElementById('6box').innerHTML;
              var replayMarker = null;
              var replayPreviousFocus = null;
              var replayActiveFlightId = null;
              var replayOriginalPlaneState = null;

              function resetGraphContainer() {
                const container = document.getElementById('6box');
                if (container) {
                  container.innerHTML = graphContainerTemplate;
                }
              }

              function formatTimestampLabel(epochMs) {
                if (!epochMs) {
                  return '--:--:--';
                }
                const date = new Date(epochMs);
                return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
              }


              function enterReplayMode(flightId) {
                if (replayActiveFlightId === flightId) {
                  return;
                }

                replayPreviousFocus = { active: focusModeActive, flightId: focusFlightId };
                recordOriginalPlaneState(flightId);
                setFocusMode(true, flightId);
                replayActiveFlightId = flightId;

                const exitButton = document.getElementById('replay-exit');
                if (exitButton) {
                  exitButton.style.display = 'inline-flex';
                }
              }

              function exitReplayMode() {
                if (!replayActiveFlightId && !replayMarker) {
                  return;
                }

                if (replayMarker) {
                  replayMarker.remove();
                  replayMarker = null;
                }

                const controls = document.getElementById('replay-controls');
                if (controls) {
                  controls.style.display = 'none';
                }

                const exitButton = document.getElementById('replay-exit');
                if (exitButton) {
                  exitButton.style.display = 'none';
                }

                restorePlaneState();

                if (replayPreviousFocus && replayPreviousFocus.active !== undefined) {
                  setFocusMode(replayPreviousFocus.active, replayPreviousFocus.flightId);
                }

                replayPreviousFocus = null;
                replayActiveFlightId = null;
              }

              function returnToLiveViewFromReplay() {
                if (replayMarker) {
                  replayMarker.remove();
                  replayMarker = null;
                }

                restorePlaneState();
                setFocusMode(false);
                replayPreviousFocus = null;
                replayActiveFlightId = null;

                const exitButton = document.getElementById('replay-exit');
                if (exitButton) {
                  exitButton.style.display = 'none';
                }
              }

              function ensureReplayMarker(flightId, heading) {
                if (replayMarker) {
                  return replayMarker;
                }

                const markerData = plane_markers && plane_markers[flightId];
                const planeIcon = markerData ? markerData.imageName : 'testplaneicon';
                const el = document.createElement('div');
                el.className = 'planeicon';
                el.style.width = '26px';
                el.style.height = '26px';
                el.style.backgroundImage = `url('./resources/${planeIcon}.png')`;
                el.style.backgroundSize = 'contain';
                el.style.backgroundRepeat = 'no-repeat';
                el.style.transformOrigin = 'center';
                if (typeof heading === 'number') {
                  el.style.transform = `rotate(${heading}deg)`;
                }

                replayMarker = new mapboxgl.Marker(el, { anchor: 'center' });
                return replayMarker;
              }

              function calculatePointHeading(points, index) {
                if (!points || !points.length) {
                  return null;
                }

                const current = points[index];
                const reference = points[index - 1] || points[index + 1];

                if (!current || !reference) {
                  return null;
                }

                const toRadians = deg => deg * (Math.PI / 180);
                const toDegrees = rad => rad * (180 / Math.PI);

                const lat1 = toRadians(reference.lat);
                const lat2 = toRadians(current.lat);
                const dLon = toRadians(current.lng - reference.lng);

                const y = Math.sin(dLon) * Math.cos(lat2);
                const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
                const bearing = toDegrees(Math.atan2(y, x));
                return (bearing + 360) % 360;
              }

              function recordOriginalPlaneState(flightId) {
                if (replayOriginalPlaneState && replayOriginalPlaneState.flightId === flightId) {
                  return;
                }

                const feature = planeFeatures.find(f => f.properties && f.properties.flightid === flightId);
                const marker = plane_markers[flightId];

                replayOriginalPlaneState = {
                  flightId,
                  featureCoords: feature && feature.geometry && feature.geometry.coordinates
                    ? [...feature.geometry.coordinates]
                    : null,
                  featureDirection: feature && feature.properties ? feature.properties.direction : null,
                  featureHeading: feature && feature.properties ? feature.properties.heading : null,
                  featureAltitude: feature && feature.properties ? feature.properties.altitude : null,
                  featureSpeed: feature && feature.properties ? feature.properties.speed : null,
                  markerLngLat: marker && marker._lngLat ? { ...marker._lngLat } : null,
                  markerLocation: marker && marker.location ? [...marker.location] : null,
                  markerHeading: marker && marker.heading !== undefined ? marker.heading : null
                };
              }

              function restorePlaneState() {
                if (!replayOriginalPlaneState || !replayOriginalPlaneState.flightId) {
                  return;
                }

                const { flightId, featureCoords, featureDirection, featureHeading, featureAltitude, featureSpeed, markerLngLat, markerLocation, markerHeading } = replayOriginalPlaneState;

                const feature = planeFeatures.find(f => f.properties && f.properties.flightid === flightId);
                if (feature && featureCoords) {
                  feature.geometry.coordinates = [...featureCoords];
                  if (feature.properties) {
                    feature.properties.direction = featureDirection;
                    feature.properties.heading = featureHeading;
                    feature.properties.altitude = featureAltitude;
                    feature.properties.speed = featureSpeed;
                  }
                }

                const marker = plane_markers[flightId];
                if (marker) {
                  if (markerLngLat) {
                    marker._lngLat = { ...markerLngLat };
                  }
                  if (markerLocation) {
                    marker.location = [...markerLocation];
                  }
                  if (markerHeading !== null && markerHeading !== undefined) {
                    marker.heading = markerHeading;
                  }
                }

                applyFilters();
                replayOriginalPlaneState = null;
              }

              function applyReplayPositionToPlane(flightId, point, heading) {
                let updated = false;
                const feature = planeFeatures.find(f => f.properties && f.properties.flightid === flightId);

                if (feature && feature.geometry && Array.isArray(feature.geometry.coordinates)) {
                  feature.geometry.coordinates = [point.lng, point.lat];
                  if (feature.properties) {
                    if (typeof heading === 'number') {
                      feature.properties.direction = heading;
                      feature.properties.heading = heading;
                    }
                    feature.properties.altitude = point.altitude ?? feature.properties.altitude;
                    feature.properties.speed = point.speed ?? feature.properties.speed;
                  }
                  updated = true;
                }

                const marker = plane_markers[flightId];
                if (marker) {
                  marker._lngLat = { lat: point.lat, lng: point.lng };
                  marker.location = [point.lat, point.lng];
                  if (typeof heading === 'number') {
                    marker.heading = heading;
                  }
                  updated = true;
                }

                if (updated) {
                  applyFilters();
                }

                return updated;
              }

              function highlightChartPoint(targetIndex) {
                if (!myLineChart) {
                  return;
                }

                const activePoints = [];
                myLineChart.data.datasets.forEach((dataset, datasetIndex) => {
                  const chartIndex = dataset.data.findIndex(point => point.originalIndex === targetIndex);
                  if (chartIndex >= 0) {
                    const metaPoint = myLineChart.getDatasetMeta(datasetIndex).data[chartIndex];
                    if (metaPoint) {
                      activePoints.push(metaPoint);
                    }
                  }
                });

                if (activePoints.length) {
                  myLineChart.tooltip._active = activePoints;
                  myLineChart.tooltip.update(true);
                  myLineChart.draw();
                }
              }

              function updateReplayPosition(index, points, flightId, activateReplay = true) {
                if (!points.length || !points[index]) {
                  return;
                }

                const slider = document.getElementById('replay-slider');
                const controls = document.getElementById('replay-controls');
                if (slider && controls) {
                  controls.style.display = 'flex';
                  slider.max = points.length - 1;
                  slider.value = index;
                }

                const atLatestPoint = index === points.length - 1;

                const point = points[index];
                const timestampLabel = formatTimestampLabel(point.timestamp);
                const altitudeLabel = `${numberWithCommas(Math.round(point.altitude || 0))} ft`;
                const speedLabel = `${numberWithCommas(Math.round(point.speed || 0))} kts`;

                const tsElem = document.getElementById('replay-timestamp');
                const altElem = document.getElementById('replay-altitude');
                const spdElem = document.getElementById('replay-speed');

                if (tsElem) tsElem.textContent = timestampLabel;
                if (altElem) altElem.textContent = altitudeLabel;
                if (spdElem) spdElem.textContent = speedLabel;

                if (activateReplay) {
                  if (atLatestPoint) {
                    returnToLiveViewFromReplay();
                    highlightChartPoint(index);
                    return;
                  }

                  enterReplayMode(flightId);
                  const heading = calculatePointHeading(points, index);
                  const planeUpdated = applyReplayPositionToPlane(flightId, { ...point }, heading);

                  if (!planeUpdated) {
                    ensureReplayMarker(flightId, heading);
                    if (replayMarker && point.lng && point.lat) {
                      const element = replayMarker.getElement();
                      if (element && typeof heading === 'number') {
                        element.style.transform = `rotate(${heading}deg)`;
                      }
                      replayMarker.setLngLat([point.lng, point.lat]).addTo(map);
                    }
                  } else if (replayMarker) {
                    replayMarker.remove();
                    replayMarker = null;
                  }

                  if (point.lng && point.lat) {
                    map.flyTo({ center: [point.lng, point.lat], zoom: Math.max(map.getZoom(), 6), speed: 0.6 });
                  }
                  highlightChartPoint(index);
                }
              }

              function initializeReplayControls(flightId, points) {
                const slider = document.getElementById('replay-slider');
                const controls = document.getElementById('replay-controls');
                const exitButton = document.getElementById('replay-exit');

                if (!slider || !controls) {
                  return;
                }

                slider.oninput = function() {
                  const idx = parseInt(slider.value, 10) || 0;
                  updateReplayPosition(idx, points, flightId);
                };

                if (exitButton) {
                  exitButton.onclick = function() {
                    exitReplayMode();
                  };
                }

                if (points.length > 0) {
                  controls.style.display = 'flex';
                  slider.max = points.length - 1;
                  slider.value = points.length - 1;
                  updateReplayPosition(points.length - 1, points, flightId, false);
                } else {
                  controls.style.display = 'none';
                }
              }

              function startReplayAtIndex(index, flightId, points) {
                if (!points.length) {
                  return;
                }
                const clampedIndex = Math.min(Math.max(index, 0), points.length - 1);
                updateReplayPosition(clampedIndex, points, flightId);
              }

              function nearestAirport(lat, lng){
                for (const air in AIRPORT_LOCATION_DATA){
                  airLat = AIRPORT_LOCATION_DATA[air]['coordinates'].split(',')[0]
                  airLong = AIRPORT_LOCATION_DATA[air]['coordinates'].split(', ')[1]
                  dist = getDistanceFromLatLonInKm(lat, lng, airLat, airLong)
                  if (dist < 5){
                    return air
                  }
                }
                return null
              }

              var searchTerms = [''];
              var trendingContainer;

              document.getElementById('search-input').removeAttribute('readonly')
              document.getElementById('search-icon').innerHTML = '🔍'

              function showResults() {
                  var input = document.getElementById('search-input').value.toLowerCase();
                  const resultsContainer = document.getElementById('search-results');

                  // Clear previous results
                  resultsContainer.innerHTML = '';

                  if (input) {
                      // Filter search terms based on input
                      var filteredTerms = searchTerms.filter(term =>
                        term && term.toLowerCase().includes(input) // Check if term is not null or undefined
                    );

                      // If results are found, display them
                      if (filteredTerms.length > 0) {
                          fidsInSearch = new Set();
                          resultsContainer.style.display = 'block';
                          filteredTerms.forEach(term => {
                              if (name_flightid[term] !== undefined){
                                for (const t of name_flightid[term]) {
                                  fid = t;
                                  if (fidsInSearch.has(fid)){
                                    continue
                                  }
                                  fidsInSearch.add(fid)
                                  let start = outboundFlightsDict[fid];
                                  let end = inboundFlightsDict[fid];
                                  const status = latlngs_dict[fid]?.status ?? "Parked"
                                  if (start === undefined) {
                                    start = '????';
                                  }
                                  if (end === undefined) {
                                    end = '????';
                                  }
                                  const msg = start + ' → ' + end;
                                  const iHTML = "<b style='background:#FFC300; color: black;'>" + msg + "</b>&nbsp;[" + status + "]<p style='left: 50%; font-size:14px;' onclick=\"redirectToMarker('" + fid + "')\">" + term + "</p>";
                                  const resultItem = document.createElement("a");
                                  resultItem.innerHTML = iHTML;
                                  resultsContainer.appendChild(resultItem);
                                }
                              }
                          });
                      } else {
                          resultsContainer.style.display = 'none';
                      }
                  } else {
                      resultsContainer.style.display = 'none';
                  }
              }

              function generateShare(){
                document.getElementById('sharebutton').innerHTML = 'Copied!'
                p = document.getElementById('serverdropdown').innerHTML[0].toLowerCase() + CURRENT_MARKER[0].flightid
                navigator.clipboard.writeText('https://infiniteview.app/tracker?f='+p)
              }

              function downloadLink(){
                window.open('https://infiniteview.app/download?access='+downloadKey+'&fid='+CURRENT_MARKER[0].flightid, '_blank');document.getElementById("globediv").innerHTML = "<a href="+globelink+" style='font-size:10px; text-align: center; padding: 0px;'>[View in globe mode. This is an experimental feature.]</p>"
              }

              function roundToNearestFiveMinutes(date) {
                const ms = 1000 * 60 * 5; // 5 minutes in milliseconds
                return new Date(Math.round(date.getTime() / ms) * ms);
              }

              function showTrending(s){
                trendingContainer = document.getElementById('search-results')
                rankedAirports = Object.entries(atc_dict)
                .map(([key, value]) => {
                  // Calculate the score (inbound + outbound) for each key
                  const score = value.inbound + value.outbound;
                  return { key, score };
                })
                .sort((a, b) => b.score - a.score)  // Sort by score in descending order
                .slice(0,5)
                .map(item => item.key);  // Extract the keys in sorted order

                rankedPlanes = Object.entries(latlngs_dict)
                  .map(([key, value]) => {
                    // Calculate the score (inbound + outbound) for each key
                    const score = value.views;
                    return { key, score };
                  })
                .filter(obj => obj.score !== undefined)
                .sort((a, b) => b.score - a.score)  // Sort by score in descending order
                .slice(0,5)
                .map(item => item.key);  // Extract the keys in sorted order
                if (s == 'show'){
                  trendingContainer.innerHTML = "<br><h4 style='text-align: center;'>Trending flights [PAST HOUR]</h4><hr>"
                  for (i=0; i<Math.min(3, rankedAirports.length); i++){
                    fid = rankedPlanes[i]
                    term = latlngs_dict[fid]['username']
                    start = outboundFlightsDict[fid]
                    end = inboundFlightsDict[fid]
                    status = latlngs_dict[fid]['status']
                    if (start == undefined){
                      start = '????'
                    }
                    if (end == undefined){
                      end = '????'
                    }
                    msg = start + ' → ' + end
                    iHTML = "<div onclick=\"redirectToMarker('"+fid+"')\"' style='background-color: #2c2c2c; width: 95%; margin: 10px auto; border-radius: 12px; padding: 10px; color: #f0f0f0; display: flex; align-items: center; justify-content: space-between;'><div style='flex-grow: 1;'><span style='font-weight: bold; color: #FFC300;'>"+(i+1).toString()+".</span> <span style='background: #FFC300; color: black; padding: 2px 8px; border-radius: 5px; font-weight: bold;'>"+msg+"</span> <span style='font-size: 14px; margin-left: 20px; cursor: pointer;'><br><br>"+term+"</span></div><div style='display: flex; align-items: center;'><div font-size: 10px; padding: 5px 10px; margin-right: 10px;'><b style='color: white;'>"+latlngs_dict[fid]['views']+"👁️</b></div></div></div>"
                    trendingContainer.innerHTML += iHTML
                  }

                  trendingContainer.innerHTML += "<br><h4 style='text-align: center;'>Busiest airports</h4><hr>"
                  for (i=0; i<Math.min(3, rankedAirports.length); i++){
                    term = rankedAirports[i]
                    iata = atc_dict[term]['title'][0]
                    name = atc_dict[term]['title'][2]
                    if (term in active_atc){
                      fid = term
                      iHTML = "<div style='background-color: #2c2c2c; width: 95%; margin: 10px auto; border-radius: 12px; padding: 10px; color: #f0f0f0;'><div style='display: flex; align-items: center; justify-content: space-between;'><span style='font-weight: bold; color: white;'>"+(i+1).toString()+".</span><span style='background: #57b685; color: black; padding: 5px 8px; border-radius: 5px; font-weight: bold;'>ATC</span><span style='margin-left: 10px; font-weight: bold; font-size: 14px;'>("+term+"/"+iata+")</span><span style='margin-left: 20px; font-size: 10px;'>"+atc_dict[term]['inbound']+" | "+atc_dict[term]['outbound']+"</span></div><p style='text-align: center; font-size: 14px; margin-top: 10px; cursor: pointer;' onclick=\"redirectToMarker('"+fid+"')\">"+name+"</p></div>"

                    } else {
                      fid = name
                      iHTML = "<div style='background-color: #2c2c2c; width: 95%; margin: 10px auto; border-radius: 12px; padding: 10px; color: #f0f0f0;'><div style='display: flex; align-items: center; justify-content: space-between;'><span style='font-weight: bold; color: white;'>"+(i+1).toString()+".</span><span style='background:#3b438f; color: black; padding: 5px 8px; border-radius: 5px; font-weight: bold;'>No ATC</span><span style='margin-left: 10px; font-weight: bold; font-size: 14px;'>("+term+"/"+iata+")</span><span style='margin-left: 20px; font-size: 10px;'>"+atc_dict[term]['inbound']+" | "+atc_dict[term]['outbound']+"</span></div><p style='text-align: center; font-size: 14px; margin-top: 10px; cursor: pointer;' onclick=\"redirectToMarker('"+fid+"')\">"+name+"</p></div>"
                    }
                    trendingContainer.innerHTML += iHTML
                    trendingContainer.style.display = 'block';
                  }
                } else {
                  trendingContainer.style.display = 'none';
                }
              }

              function readATIS(){
                text = document.getElementById('atistext').innerHTML.split('<')[0]
                const numberToWord = [
                  'zero', 'one', 'two', 'three', 'four',
                  'five', 'six', 'seven', 'eight', 'nine'
                ];
                text.replace(/\d+/g, (number) => {
                  return number
                    .split('') // Split the number into individual digits
                    .map(digit => numberToWord[digit]) // Map each digit to its word
                    .join(' '); // Join the words with a space
                });
                console.log(text)
                if (text.length > 30){
                  const utterance = new SpeechSynthesisUtterance(text);
                  utterance.lang = 'en-GB';
                  window.speechSynthesis.speak(utterance);
                }
              }

                  const toggleButton = document.getElementById('flightHistoryToggle');
                  const flightsContainer = document.getElementById('flightHistoryFlightsContainer');
                  const flightList = document.getElementById('flightHistoryFlightList');
                  const chevronIcon = toggleButton.querySelector('.fa-chevron-down');

                  // Toggle flight history visibility
                  toggleButton.addEventListener('click', function() {
                      flightsContainer.classList.toggle('flight-history-visible');

                      if (flightsContainer.classList.contains('flight-history-visible')) {
                          chevronIcon.style.transform = 'rotate(180deg)';
                          // Fetch flights when the container is opened
                          fetchFlights();
                      } else {
                          chevronIcon.style.transform = 'rotate(0deg)';
                      }
                  });

                  // Function to format duration from minutes to "Xh Ym"
                  function formatDuration(minutes) {
                      if (minutes === 0) return '0h 0m';

                      const hours = Math.floor(minutes / 60);
                      const mins = Math.floor(minutes % 60);
                      return `${hours}h ${mins}m`;
                  }

                  // Function to format date
                  function formatDate(isoString) {
                      const date = new Date(isoString);
                      return date.toLocaleDateString('en-US', {
                          month: 'short',
                          day: 'numeric',
                          year: 'numeric'
                      });
                  }

                  // Function to extract airline from callsign
                  function extractAirline(callsign) {
                      // Remove heavy/medium designations
                      return callsign.replace(/ (Heavy|Medium|Light)$/i, '');
                  }

                  // Fetch flights from API
                  async function fetchFlights() {
                    try {
                        const response = await fetch(PREVIOUS_FLIGHTS_LINK, {
                            headers: {
                                'User-Agent': 'UptimeRobot'
                            }
                        });

                        if (!response.ok) {
                            throw new Error(`API returned status ${response.status}`);
                        }

                        const data = await response.json();

                        // Process the flights
                        processFlights(data.response);

                    } catch (error) {
                        console.error('Error fetching flights:', error);
                        flightList.innerHTML = '<div class="flight-history-error">Error loading flight data. Please try again.</div>';

                    }
                  }

                  // Process flights data and render
                  function processFlights(flights) {
                      // Clear loading state
                      flightList.innerHTML = '';

                      // Process and add flights to the list
                      flights.slice(0, 5).forEach(flight => {
                          const flightItem = document.createElement('div');
                          flightItem.className = 'flight-history-flight-item';

                          const flightName = extractAirline(flight.callsign);
                          const flightDate = formatDate(flight.created);
                          const flightTime = formatDuration(flight.duration);

                          flightItem.innerHTML = `
                              <div class="flight-history-flight-header">
                                  <div class="flight-history-flight-name">${flightName}</div>
                                  <div class="flight-history-flight-date">${flightDate}</div>
                              </div>
                              <div class="flight-history-flight-info">
                                  <div class="flight-history-route">
                                    ${flight.start || 'N/A'} → ${flight.end || 'N/A'}
                                  </div>
                                  <div class="flight-history-times">
                                      <div class="flight-history-time-block">
                                          <span class="flight-history-time-label">Duration</span>
                                          <span class="flight-history-time-value">${flightTime}</span>
                                      </div>
                                  </div>
                              </div>
                          `;

                          flightList.appendChild(flightItem);
                      });
                  }

              function airport(serverurl){
                clearAllPolygons()
                var xhr = new XMLHttpRequest();
                xhr.open('GET', "https://api.infiniteview.app/getAtcFacilities?apikey=ZNvNHJYC5IcLYUMlFpBI&sessionid=" + serverurl, true);
                xhr.send();
                xhr.addEventListener("readystatechange", processRequest, false);

                function processRequest(e) {
                  if (xhr.readyState == 4 && xhr.status == 200) {
                    response = JSON.parse(xhr.responseText)['airports']['result'];
                    events = JSON.parse(xhr.responseText)['events']
                    all_facilities = {}
                    atcGroup.forEach(marker => marker.remove());
                    nonAtcGroup.forEach(marker => marker.remove());
                    atcGroup = []
                    nonAtcGroup = []
                    active_atc = {}
                    airport_markers = {}
                    date = new Date()
                    // global for timeline
                    inboundFlightsDict = {}
                    outboundFlightsDict = {}
                    var hasActiveATC = []
                    //add events first
                    for (eIndex = 0; eIndex < events.length; eIndex++){
                      addPolygon(events[eIndex].coordinates, events[eIndex].eventType, "<div style='color: black;'><strong>" + events[eIndex].eventName +'<\strong><br>Submitted by @' + events[eIndex].submittedBy + '</div>')
                    }
                    for (i = 0; i < response.length; i++) {
                      className = 'airportnotactive'
                      // loop through inbound and outbound and add to dict
                      icaoToUse = response[i]['airportIcao']
                      for (j=0; j < response[i]['inboundFlights'].length; j++){
                        inboundFlightsDict[response[i]['inboundFlights'][j]] = icaoToUse
                      }
                      for (j=0; j < response[i]['outboundFlights'].length; j++){
                        outboundFlightsDict[response[i]['outboundFlights'][j]] = icaoToUse
                      }
                      if (response[i]['atcFacilities'].length > 0){
                        className = 'airportactive'
                        icao = icaoToUse
                        hasActiveATC.push(icao)
                        for (j = 0; j < response[i]['atcFacilities'].length; j++){
                          try{
                            var lat = AIRPORT_LOCATION_DATA[icao]['coordinates'].split(',')[0]
                            var long = AIRPORT_LOCATION_DATA[icao]['coordinates'].split(',')[1]
                          }catch(err){
                            continue;
                          }
                          var name = response[i]['atcFacilities'][j].airportName
                          var controller = response[i]['atcFacilities'][j].username
                          var type = response[i]['atcFacilities'][j].type
                          var atc_converted = atc_frequency_convert[type]

                          if (('ATIS' in response[i]) && response[i]['ATIS'] != null){
                            if (active_atc.hasOwnProperty(name) == false){
                              active_atc[name] = {}
                              active_atc[name]['ATISMSG'] = response[i]['ATIS']
                            } else {
                              active_atc[name]['ATISMSG'] = response[i]['ATIS']
                            }
                          }

                          if (active_atc.hasOwnProperty(name) == false){
                            active_atc[name] = {}
                            active_atc[name][atc_converted] = controller
                          } else{
                            active_atc[name][atc_converted] = controller
                          }
                        }
                      } else {
                        try {
                          var icao = response[i]['airportIcao']
                          var lat = AIRPORT_LOCATION_DATA[icao]['coordinates'].split(',')[0]
                          var long = AIRPORT_LOCATION_DATA[icao]['coordinates'].split(',')[1]
                          var name = AIRPORT_LOCATION_DATA[icao]['name']
                          active_atc[name] = 'This airport has no active ATC.'
                        } catch(err){
                          continue;
                        }
                      }
                      inboundN = response[i]['inboundFlights'].length
                      outboundN = response[i]['outboundFlights'].length

                      const el = document.createElement('div');
                      el.className = className;
                      el.style.width = 15
                      el.style.height = 20
                      el.backgroundPosition = 'bottom center'
                      const marker = new mapboxgl.Marker(el, {anchor: 'bottom'}).setLngLat([long, lat]).addTo(map)
                      marker.title = icao
                      marker.inbound = response[i]['inboundFlights']
                      marker.outbound = response[i]['outboundFlights']
                      el.addEventListener('click', () => {
                          LOADING = true
                          // Call the function and pass custom parameters when the marker is clicked
                          el.backgroundImage = "url('./resources/airportclicked.png')"
                          onAirportClick(marker);
                      }, false);

                      function onAirportClick(e){
                        ifclick = "yes"
                        markerClicked = true
                        if (CURRENT_MARKER && CURRENT_MARKER.length > 1){
                          if (CURRENT_MARKER[1].includes('plane') || CURRENT_MARKER[1].includes('santa')){
                              CURRENT_MARKER[0].getElement().children[0].style.backgroundImage = "url('./resources/"+CURRENT_MARKER[1]+".png')"
                          }else{
                            CURRENT_MARKER[0].getElement().style.backgroundImage = "url('./resources/"+CURRENT_MARKER[1]+".png')"
                          }
                          //map.removeLayer(flightpath);
                        }
                        openNav()

                        CURRENT_TRACK = e.title
                        CURRENT_MARKER = [e, e.getElement().className.split(' ')[0], '']
                        console.log(e)
                        inbound = e.inbound
                        outbound = e.outbound
                        inboundList = []
                        outboundList = []

                        var icao = e.title
                        //console.log(atc_dict[e.title], response[atc_dict[e.title]['index']], response[atc_dict[e.title]['index']]['airportIcao'])
                        lat = AIRPORT_LOCATION_DATA[icao]['coordinates'].split(',')[0]
                        long = AIRPORT_LOCATION_DATA[icao]['coordinates'].split(',')[1]

                        delayedCount = 0
                        totalCount = 0
                        totalStillatAirport = 0

                        // Inbound traffic handler
                        for (j=0; j< inbound.length; j++){
                          plane = inbound[j]
                          //totalCount += 1
                          try{
                            dist = getDistanceFromLatLonInKm(latlngs_dict[plane]['lat'], latlngs_dict[plane]['lng'], lat, long)
                            t = parseInt((dist / (latlngs_dict[plane]['speed'] * 1.852)) * 60 + latlngs_dict[plane]['alt']/3000)
                            if (latlngs_dict[plane]['alt'] > 15000){
                              t += latlngs_dict[plane]['alt']/2000
                            }

                            numberOfMlSeconds = date.getTime();
                            addMlSeconds = 60 * 1000 * (t);
                            newDateObj = new Date(numberOfMlSeconds + addMlSeconds);
                            timeFormatted = (newDateObj.getHours() < 10 ? "0" : "") + newDateObj.getHours() + ":" + (newDateObj.getMinutes() < 10 ? "0" : "") + newDateObj.getMinutes()

                            endAirport = inboundFlightsDict[plane]
                            startAirport = outboundFlightsDict[plane]
                            aLat = AIRPORT_LOCATION_DATA[endAirport]['coordinates'].split(',')[0]
                            aLong = AIRPORT_LOCATION_DATA[endAirport]['coordinates'].split(', ')[1]
                            speed = latlngs_dict[plane]['speed']
                            dist = getDistanceFromLatLonInKm(lat, long, aLat, aLong)
                            timeToFly = dist / (speed * 1.852)
                            numberOfMlSeconds = date.getTime();
                            progress = dist
                            addMlSeconds = 60 * 60 * 1000 * (timeToFly);
                            newDateObj4 = new Date(numberOfMlSeconds + addMlSeconds);
                            predictedArrival = (newDateObj4.getHours() < 10 ? "0" : "") + newDateObj4.getHours() + ":" + (newDateObj4.getMinutes() < 10 ? "0" : "") + newDateObj4.getMinutes()

                            if (newDateObj4 > (newDateObj+15*60000)){
                              latlngs_dict[plane]['time'] = 'Delayed'
                            }

                            if (latlngs_dict[plane]['speed'] > 100){
                              try{
                                inboundList.push({'name' : latlngs_dict[plane]['username'], 'dist' : dist, 'time': latlngs_dict[plane]['time'], 'due' : t, 'format' : timeFormatted, 'flightid' : plane, 'municipality' : AIRPORT_LOCATION_DATA[startAirport]['municipality'], 'icao':startAirport})
                              }catch(err){
                                inboundList.push({'name' : latlngs_dict[plane]['username'], 'dist' : dist, 'time': latlngs_dict[plane]['time'], 'due' : t, 'format' : timeFormatted, 'flightid' : plane, 'municipality' : 'Unknown', 'icao' : '????'})
                              }
                            }
                          }catch(err){
                              console.log(err)
                          }
                        }

                        // Outbound traffic handler
                        for (j=0; j < outbound.length; j++){
                          try{
                            plane = outbound[j]
                            totalCount += 1
                            if (latlngs_dict[plane]['speed'] < 100){
                              // Now check still at departure airport
                              dist = getDistanceFromLatLonInKm(latlngs_dict[plane]['lat'], latlngs_dict[plane]['lng'], lat, long)
                              if (dist < 10){
                                timeLeftMins = 20 - 0.5 * latlngs_dict[plane]['length']
                                totalStillatAirport += 1
                                if (timeLeftMins > 0){
                                  numberOfMlSeconds = date.getTime();
                                  addMlSeconds = 60 * 1000 * (timeLeftMins);
                                  newDateObj = new Date(numberOfMlSeconds + addMlSeconds - 5*60*1000);
                                  newDateObj = roundToNearestFiveMinutes(newDateObj)
                                  timeFormatted = (newDateObj.getHours() < 10 ? "0" : "") + newDateObj.getHours() + ":" + (newDateObj.getMinutes() < 10 ? "0" : "") + newDateObj.getMinutes()
                                } else {
                                  delayedCount += 1
                                  numberOfMlSeconds = date.getTime();
                                  addMlSeconds = 60 * 1000 * (timeLeftMins);
                                  newDateObj = new Date(numberOfMlSeconds + addMlSeconds - 5*60*1000);
                                  newDateObj = roundToNearestFiveMinutes(newDateObj)
                                  timeFormatted = (newDateObj.getHours() < 10 ? "0" : "") + newDateObj.getHours() + ":" + (newDateObj.getMinutes() < 10 ? "0" : "") + newDateObj.getMinutes()
                                }

                                endAirport = inboundFlightsDict[plane]
                                if (latlngs_dict[plane]['time'] === 'On Time'){
                                  outboundList.push({'name' : latlngs_dict[plane]['username'], 'dist' : dist, 'due': timeLeftMins, 'time' : timeFormatted, 'format' : timeFormatted, 'flightid' : plane, 'status' : 'Scheduled', 'municipality': AIRPORT_LOCATION_DATA[endAirport]['municipality'], 'icao':endAirport})
                                } else {
                                  timeFormatted += '*'
                                  outboundList.push({'name' : latlngs_dict[plane]['username'], 'dist' : dist, 'due': timeLeftMins, 'time' : timeFormatted, 'format' : timeFormatted, 'flightid' : plane, 'status' : latlngs_dict[plane]['time'], 'municipality': AIRPORT_LOCATION_DATA[endAirport]['municipality'], 'icao':endAirport})
                                }
                              }
                            }
                          } catch(err){
                            console.log(err, endAirport)
                          }
                        }

                        inboundList.sort(compare)
                        outboundList.sort(compare)
                        // --- CONFIGURABLE WEIGHTS ---
                        const DELAY_WEIGHT = 1 / 20;       // previously 1/30
                        const STILL_WEIGHT = 1 / 20;       // previously 1/50
                        const INBOUND_WEIGHT = 1 / 100;    // previously 1/300
                        const INBOUND_TIME_DECAY = 0.025;  // previously 0.03

                        // --- Helper: inbound congestion weighting by arrival time ---
                        function calcInboundPressure(list, timeShift = 0) {
                          let pressure = 0;
                          for (const flight of list) {
                            const mins = Math.max(0, (flight.due ?? 30) - timeShift);
                            const weight = Math.exp(-INBOUND_TIME_DECAY * mins);
                            pressure += weight;
                          }
                          return pressure;
                        }

                        // --- Compute ratio (now or at future offset) ---
                        function calcRatio(timeShift = 0) {
                          const inboundPressure = calcInboundPressure(inboundList, timeShift);
                          let r =
                            delayedCount * DELAY_WEIGHT +
                            totalStillatAirport * STILL_WEIGHT +
                            inboundPressure * INBOUND_WEIGHT;

                          if (totalStillatAirport < 5) r *= 0.8;
                          return Math.max(0.1, Math.min(r, 1)); // clamp between 0.1 and 1
                        }

                        // --- Calculate now, +15 min, +30 min ---
                        const ratioNow = calcRatio(0);
                        const ratio15 = calcRatio(15);
                        const ratio30 = calcRatio(30);

                        // --- Define current traffic level ---
                        const levels = [
                          { threshold: 0.8, text: "very busy, expect delays.", color: "#ff6961" },
                          { threshold: 0.4, text: "busy, possible delays.", color: "#fdfd96" },
                          { threshold: 0.0, text: "quiet, no delays expected.", color: "#C1E1C1" },
                        ];

                        let { text: baseText, color: trafficColour } =
                          levels.find(l => ratioNow > l.threshold) || levels.at(-1);

                        // --- Forecast logic ---
                        const change30 = ratio30 - ratioNow;
                        const absChange = Math.abs(change30);
                        const currentTime = new Date();
                        const futureTime = new Date(currentTime.getTime() + 30 * 60000);
                        const formatTime = t => t.toTimeString().slice(0, 5);

                        let forecastText = "";
                        if (absChange > 0.1) {
                          // significant change
                          if (change30 > 0) {
                            const factor = (ratio30 / ratioNow).toFixed(1);
                            forecastText = ` Traffic expected to build up around ${formatTime(futureTime)} (about ${factor}× current levels).`;
                          } else {
                            const factor = (ratio30 / ratioNow).toFixed(1);
                            forecastText = ` Traffic expected to ease around ${formatTime(futureTime)}, dropping to about ${factor}× current levels.`;
                          }
                        } else {
                          // stable conditions
                          forecastText = ` Traffic levels expected to remain steady through ${formatTime(futureTime)}.`;
                        }

                        // --- Final human-readable output ---
                        const trafficText = `Airport is ${baseText}${forecastText}`;

                        document.getElementById('flight-info-panel').style.display = 'none'
                        document.getElementById('flightplan').style.display = 'none'
                        document.getElementById('aircraftimage').style.display = 'none'
                        document.getElementById('2Box').style.borderRadius = '0px 0px 10px 10px'
                        document.getElementById('8box').style = 'margin: 0px; display: none;' // hide user info
                        if (AIRPORT_LOCATION_DATA[atc_dict[e.title]["title"][1]].elevation_ft != undefined){
                          if (GLOBAL_LOCATION){
                            globelink = 'https://infiniteview.app/'+GLOBAL_LOCATION+'?airport=' + atc_dict[e.title]["title"][1] + '&serverid=' + serverid + '&airportalt=' + AIRPORT_LOCATION_DATA[atc_dict[e.title]["title"][1]].elevation_ft + '&globedelay=' + globedelay
                            document.getElementById('globebox').style = 'margin: 0px; background: linear-gradient(to bottom right,#36669c,#41a0ae,#3ec995,#77f07f); padding: 2px;'
                            document.getElementById("globetext").innerHTML = "<a href="+globelink+">Click here to view in globe mode</a>"
                          }
                        } else {
                          document.getElementById('globebox').style = 'margin: 0px; display: none;'
                        }

                        document.getElementById("flight-info-panel").style.display = 'none'
                        pct = (Math.min(ratioNow, 1)*100).toFixed(2)

                        document.getElementById('airportpage-name').textContent = atc_dict[e.title]["title"][2];
                        document.getElementById('airportpage-code').textContent = atc_dict[e.title]["title"][0];
                        document.getElementById('airportpage-inbound').textContent = inboundList.length;
                        document.getElementById('airportpage-outbound').textContent = outboundList.length;
                        document.getElementById('airportpage-delayValue').textContent = `${(pct/100 * 5).toFixed(2)} / 5`;
                        const barFill = document.getElementById('airportpage-barFill');
                        barFill.style.width = `${pct}%`;
                        if (document.getElementById('mySidenav').classList.contains('fire-glow')){
                          document.getElementById('mySidenav').classList.remove('fire-glow');
                        }
                        document.getElementById('airportpage-footer').innerHTML = trafficText
                        if (pct/100 * 5 < 2) {
                          barFill.style.backgroundColor = '#238636';
                        } else if (pct/100 * 5 < 4) {
                          barFill.style.backgroundColor = '#e3b341';
                        } else {
                          barFill.style.backgroundColor = '#da3633';
                        }
                        atc_dict[e.title]['pct'] = pct
                        csspositiontofrequency = {'ATIS' : '31', 'Ground' : '32', 'Tower' : '41',
                                                  'Approach' : '42', 'Departure' : '51', 'Centre' : '52'}

                        for (const [key, value] of Object.entries(csspositiontofrequency)) {
                          try{
                            if(active_atc[e.title][key] != undefined){
                              document.getElementById(value+'Title').style.color = '#C1E1C1'
                              document.getElementById(value+'Title').innerHTML = key
                              document.getElementById(value+'Text').innerHTML = active_atc[e.title][key]
                              document.getElementById(value+'Text').style.color = '#e5e5e5'
                            }else{
                              document.getElementById(value+'Title').style.color = '#ff6961'
                              document.getElementById(value+'Title').innerHTML = key
                              document.getElementById(value+'Text').innerHTML = '---'
                              document.getElementById(value+'Text').style.color = '#e5e5e5'
                            }
                          }catch(err){
                            document.getElementById(value+'Title').style.color = '#ff6961'
                            document.getElementById(value+'Title').innerHTML = key
                            document.getElementById(value+'Text').innerHTML = '---'
                            document.getElementById(value+'Text').style.color = '#e5e5e5'
                          }
                        }
                        try{
                          document.getElementById('atistext').innerHTML = 'Waiting for ATIS update...'
                          document.getElementById('2Box').style.display = 'block'
                          if ('ATISMSG' in active_atc[e.title]){
                            document.getElementById('atisbox').style.display = 'block'
                            if (active_atc[e.title]['ATISMSG'] != null){
                              document.getElementById('atistext').innerHTML = active_atc[e.title]['ATISMSG']
                              updateDisplay(parseATIS(active_atc[e.title]['ATISMSG']))
                              //document.getElementById('atistext').innerHTML += "<button style='float: right; border-radius: 5px; background: #444;' onclick='readATIS()' >🔈</button>"
                            }
                          } else {
                            document.getElementById('atisbox').style.display = 'none'
                          }
                        } catch(err){
                          document.getElementById('atisbox').style.display = 'none'
                        }
                        txt = ''
                        document.getElementById('6box').innerHTML = "<p>Arrival Board ("+inboundList.length+")</p><div class='flight-list' id='flight-list-in'>"
                        document.getElementById('globebox').style.display = 'none'
                        for (j=0; j<inboundList.length; j++){
                          try{
                            fid = inboundList[j]['flightid']
                            fl = latlngs_dict[fid]
                            addFlight(fl['callsign'], inboundList[j]['icao']+' → '+ atc_dict[e.title]["title"][1], inboundList[j]['municipality'], inboundList[j]['format'], fl['aircraft'], fl['airline'], fl['alt'], inboundList[j]['time'], fl["liveryId"], fid, 'in')
                          } catch(err){
                            console.log(err)
                          }
                        }

                        document.getElementById('7box').innerHTML = "<p>Departure Board ("+outboundList.length+")</p><div class='flight-list' id='flight-list-out'>"

                        for (j=0; j<outboundList.length; j++){
                          try{
                            fid = outboundList[j]['flightid']
                            fl = latlngs_dict[fid]
                            addFlight(fl['callsign'], atc_dict[e.title]["title"][1]+' → '+outboundList[j]['icao'], outboundList[j]['municipality'], outboundList[j]['format'], fl['aircraft'], fl['airline'], fl['alt'], outboundList[j]['time'], fl["liveryId"], fid, 'out')
                          } catch(err){
                            console.log(err)
                          }
                        }

                        TYPE = 'airport'
                        LOADING = false
                        setTimeout(delayed, 100)

                        function delayed(){
                          openNav()
                          marker.getElement().style.backgroundImage = "url('./resources/airportclicked.png')"
                        }
                      }

                      if (hasActiveATC.includes(icao)){
                        atcGroup.push(marker)
                      } else {
                        nonAtcGroup.push(marker)
                      }
                      if (map.getZoom() < 7){
                        nonAtcGroup.forEach(marker => marker.getElement().style.display = 'none');
                      }
                      airport_markers[name] = marker
                      try{
                        iata = AIRPORT_LOCATION_DATA[icao]['iata_code']
                        nm = AIRPORT_LOCATION_DATA[icao]['name']
                      } catch(err){
                        iata = '???'
                        nm = '???'
                      }

                      atc_dict[icao]= {title : [iata, icao, nm], text : 'Active Frequencies : <br><br>' + active_atc[name],
                                         index: i, inbound: inboundN, outbound: outboundN}
                      }
                  }
                  //controlSearch.setLayer(atcGroup)
                  if (ifclick == 'yes' && TO_UPDATE == 'yes'){
                    if (TYPE == 'airport'){
                      id = CURRENT_TRACK
                      at = airport_markers[id]
                      at.click()
                      TO_UPDATE = 'no'
                      UPDATING = 'no'
                      }
                    }
                  }
                }

              function flight(serverurl, po) {
                loadPlaneIcons()
                const sourceId = 'planes-source'; // Replace with your actual source ID
                const layerId = 'planes-layer';   // Replace with your actual layer ID

                const hasSource = map.getSource(sourceId) !== undefined;
                const hasLayer = map.getLayer(layerId) !== undefined;

                if (!(hasSource && hasLayer)) {
                  map.addSource('planes-source', {
                        type: 'geojson',
                        data: {
                            type: 'FeatureCollection',
                            features: []
                        }
                  });
                  map.addLayer({
                    id: 'planes-layer',
                    type: 'symbol',
                    source: 'planes-source',
                    layout: {
                      'icon-image': ['get', 'iconImage'],
                      'icon-size': [
                        'interpolate',
                        ['linear'],
                        ['zoom'],
                        3, ['*', ['get', 'iconSize'], 0.8],
                        8, ['*', ['get', 'iconSize'], 1],
                        15, ['*', ['get', 'iconSize'], 1.2]
                      ],
                      'icon-rotate': ['get', 'direction'],
                      'icon-rotation-alignment': 'map',
                      'icon-allow-overlap': true,
                      'icon-ignore-placement': true
                    }
                  });
                }

                  //PRELOAD
                name_flightid = {}
                plane_markers = {}
                delayedForSearch = {}
                var server = serverurl
                serverid = serverurl
                var response = "";
                xhr4 = new XMLHttpRequest();

                  // NETWORK/API

                  xhr4.open('GET', "https://api.infiniteview.app/flights?apikey=ZNvNHJYC5IcLYUMlFpBI&sessionid=" + serverurl, true);
                  xhr4.send();
                  xhr4.addEventListener("readystatechange", processRequest, false);

                  function processRequest(e) {
                    copylatlngs_dict = {}
                    if (xhr4.readyState == 4 && xhr4.status == 200) {
                      response = JSON.parse(xhr4.responseText);
                      if (response.length == 0){
                        console.log('uh oh')
                        return;
                      }
                      else{
                        plane_markers = {}
                        flight_dict = {}
                        document.getElementById('serverdropdown').innerHTML = document.getElementById('serverdropdown').innerHTML.split(' ')[0] + ' ['+response.length+']'

                        // Clear previous markers
                        markerGroup = []

                        // Create features array for planes
                        planeFeatures = [];

                        searchTerms = Object.keys(atc_dict)
                        for (i = 0; i < response.length; i++) {
                          // filter for VA
                          queryString = window.location.search;
                          urlParams = new URLSearchParams(queryString);
                          if (urlParams.has('va')){
                            if (response[i].virtualOrganization !== null){
                              if (!(response[i].virtualOrganization.includes(urlParams.get('va')))){
                                continue
                              }
                            } else {
                              continue
                            }
                          }
                          //DATA COLLECTION FROM THE API
                          var lat = response[i].latitude
                          var long = response[i].longitude
                          var direction = response[i].heading
                          var alt = response[i].altitude
                          var speed = response[i].speed
                          var vspeed = response[i].verticalSpeed
                          var username = response[i].username
                          /*
                          if (username == 'Santa Claus'){
                            continue
                          }
                          */
                          var flightid = response[i].flightId
                          var userId = response[i].userId
                          var heading = response[i].track
                          if (username == 'Santa Claus'){
                            heading = response[i].heading
                          }
                          var callsign = response[i].callsign
                          var length = response[i].length
                          var aircraftId = response[i].aircraftId
                          var liveryId = response[i].liveryId
                          var status = response[i].status
                          delayedForSearch[callsign] = response[i].time
                          delayedForSearch[username] = response[i].time
                          if (username != null){
                            copylatlngs_dict[flightid] = {'lat': lat, 'lng': long, 'username' : username, 'alt': alt, 'speed': speed, 'time' : response[i].time, 'length' : length, 'status' : status}
                          }else{
                            copylatlngs_dict[flightid] = {'lat': lat, 'lng': long, 'username' : callsign, 'alt': alt, 'speed': speed, 'time' : response[i].time, 'length' : length, 'status' : status}
                          }
                          copylatlngs_dict[flightid]['views'] = response[i].views
                          var planeurl = ""
                          var directorminus = 0                                    //For landing and takeoff icons (make sure they point correctly)
                          var distance = (speed/1.94384)*60  //Longer to stop the stopping!

                          if(distance > 500){
                            // first work out how far it has moved between the server request and our request
                            deltaTimeOfRequest = (Date.now()/1000 - response[0]['timeOfRequest'])
                            globedelay = Math.floor(deltaTimeOfRequest)
                            var p =   destinationPoint(lat, long, ((speed/1.94384)*deltaTimeOfRequest), heading)
                            var lat = p[0]
                            var long = p[1]
                            // now our simulated distance
                            var p = destinationPoint(lat, long, distance, heading);
                            var predictionlat = p[0]
                            var predictionlong = p[1]
                          }else{
                            var predictionlat = lat
                            var predictionlong = long
                          }

                          //Air
                          directorminus = 0;

                          planeIcon = getPlaneIcon(username, aircraftId)
                          let iconSize = 1;

                          if (planeIcon.includes('jumbo') || planeIcon.includes('777')){
                            width = '23px'
                            height = '25px'
                            iconSize = 0.07;
                          } else if (planeIcon.includes('380')){
                            width = '27px'
                            height = '25px'
                            iconSize = 0.08;
                          } else if (planeIcon.includes('a350')){
                            width = '22px'
                            height = '22px'
                            iconSize = 0.06;
                          } else if (planeIcon.includes('ga')){
                            width = '19px'
                            height = '17px'
                            iconSize = 0.05;
                          } else {
                            width = '17px'
                            height = '19px'
                            iconSize = 0.06;
                          }

                          if (!(response[i].username in name_flightid)) {
                            name_flightid[response[i].username] = [flightid];
                          } else {
                            name_flightid[response[i].username].push(flightid);
                          }

                          if (!(response[i].callsign in name_flightid)) {
                            name_flightid[response[i].callsign] = [flightid];
                          } else {
                            name_flightid[response[i].callsign].push(flightid);
                          }
                          searchTerms.push(response[i].username)
                          searchTerms.push(response[i].callsign)
                          popupName = response[i].username
                          if (popupName == null){
                            popupName = response[i].callsign
                          }

                          // Create a virtual marker object to store in plane_markers
                          const virtualMarker = {
                            flightid: flightid,
                            userid: userId,
                            title: popupName,
                            username: username,
                            callsign: callsign,
                            aircraftId: aircraftId,
                            speed: speed,
                            altitude: alt,
                            location: [lat, long],
                            heading: heading,
                            imageName: getPlaneIcon(username, aircraftId),
                            imageClickedName: getPlaneIcon(username, aircraftId).replace('infinite', '').replace('special', '') + 'clicked',
                            timestamp: Date.now(),
                            liveryId: username == 'Santa Claus' ? 'santa-force-one' : liveryId,
                            pilotState: response[i].pilotState,
                            _lngLat: { lat: lat, lng: long },
                            getElement: function() {
                              return {
                                children: [{
                                  style: {
                                    backgroundImage: null
                                  }
                                }],
                                style: {
                                  backgroundImage: null
                                }
                              };
                            }
                          };

                          plane_markers[flightid] = virtualMarker;

                          if (flightid == CURRENT_MARKER[2]){
                            CURRENT_MARKER[0] = virtualMarker;
                          }

                          callsign = response[i].callsign

                          if(response[i].virtualOrganization == null || response[i].virtualOrganization == ''){
                            organisation_message = 'This user is not a member of a Virtual Organisation'
                          } else{
                            organisation_message = 'Member of ' + response[i].virtualOrganization
                          }

                          counter = -1
                          for (j=0; j < LIVERY_DATA.length-1; j++){
                            if (LIVERY_DATA[j]['id'] === virtualMarker.liveryId){
                              counter = j
                              break
                            }
                          }
                          if (counter == -1){
                            counter = 1004
                          }
                          copylatlngs_dict[flightid]['airline'] = LIVERY_DATA[counter]['liveryName']
                          copylatlngs_dict[flightid]['liveryId'] = liveryId
                          copylatlngs_dict[flightid]['callsign'] = callsign
                          virtualMarker.credit = LIVERY_DATA[counter]['credit']
                          virtualMarker.airline = LIVERY_DATA[counter]['liveryName']
                          markerGroup.push(virtualMarker);
                          if (LIVERY_DATA[counter]['aircraftName'].split(' ').length > 1){
                            copylatlngs_dict[flightid]['aircraft'] = LIVERY_DATA[counter]['aircraftName'].split(' ')[1]
                          }else{
                            copylatlngs_dict[flightid]['aircraft'] = LIVERY_DATA[counter]['aircraftName']
                          }

                          flight_dict[flightid] = {
                            airline: LIVERY_DATA[counter]['liveryName'],
                            head: [popupName, callsign, LIVERY_DATA[counter]['aircraftName'], LIVERY_DATA[counter]['liveryName']],
                            text: [parseInt(speed), parseInt(alt), parseInt(vspeed), parseInt(heading)],
                            foot: organisation_message,
                            fid: flightid
                          };

                          // Create a GeoJSON feature for this plane
                          vo = response[i].virtualOrganization;
                          if (vo) {
                            const match = vo.match(/\[([^\]]+)\]/);
                            vo = match ? match[1] : '';
                          } else {
                            vo = '';
                          }

                          const planeFeature = {
                            type: 'Feature',
                            id: flightid,
                            geometry: {
                              type: 'Point',
                              coordinates: [long, lat]
                            },
                            properties: {
                              flightid: flightid,
                              title: popupName,
                              username: username,
                              airline: LIVERY_DATA[counter]['liveryName'],
                              aircraftType: LIVERY_DATA[counter]['aircraftName'],
                              origin: outboundFlightsDict[flightid],
                              destination: inboundFlightsDict[flightid],
                              status: response[i].time,
                              virtualAirline: vo,
                              callsign: callsign,
                              userid: userId,
                              aircraftId: aircraftId,
                              speed: speed,
                              altitude: alt,
                              lat: lat,
                              lng: long,
                              heading: heading,
                              direction: direction,
                              timestamp: Date.now(),
                              liveryId: username == 'Santa Claus' ? 'santa-force-one' : liveryId,
                              pilotState: response[i].pilotState,
                              credit: LIVERY_DATA[counter]['credit'],
                              iconImage: planeIcon,
                              clickedIconImage: planeIcon.replace('infinite', '').replace('special', '')+'clicked',
                              iconSize: iconSize
                            }
                          };

                          planeFeatures.push(planeFeature);
                          allPlanes = planeFeatures
                        }

                        // Update the planes source with the new features
                        if (map.getSource('planes-source')) {
                          map.getSource('planes-source').setData({
                            type: 'FeatureCollection',
                            features: planeFeatures
                          });

                          planeDataLoadedForServer[serverurl] = true
                          syncFavoriteFriendFlights()
                          applyFilters()
                          handlePendingFavoriteFocus()
                          renderFavoriteFlights()
                        }

                        // Remove the displayPlaneDetails function from here since it's now defined globally

                        function markerOnClick(marker) {
                          flightid = marker.flightid
                          lat = marker.location[0]
                          long = marker.location[1]
                          speed = marker.speed

                          document.getElementById("flight-info-panel").style.display = 'block'
                          document.getElementById('flightplan').style.display = 'block'
                          document.getElementById('trendingBadge').innerHTML = ''
                            if (rankedPlanes.includes(marker.flightid) || marker.username == 'WML'){
                              document.getElementById('trendingBadge').innerHTML = '🔥 #' + String(rankedPlanes.indexOf(marker.flightid) + 1)
                              if (!(document.getElementById('mySidenav').classList.contains('fire-glow'))){
                                document.getElementById('mySidenav').classList.add('fire-glow');
                              }
                            } else {
                              if (document.getElementById('mySidenav').classList.contains('fire-glow')){
                                document.getElementById('mySidenav').classList.remove('fire-glow');
                              }
                            }
                            document.getElementById('progressFill').style.background = 'var(--completed-path)'
                            if (marker.pilotState == 3){
                              if (marker.speed > 50){
                                document.getElementById('progressText').innerHTML = "Tracking via AutoPilot+"
                                document.getElementById('progressFill').style.background = '#00b5fd'
                              } else {
                                document.getElementById('progressText').innerHTML = "Parked";
                                document.getElementById('progressFill').style.background = '#444'
                              }
                            } else {
                              document.getElementById('progressText').innerHTML = "";
                            }

                            if (Date.now() - LAST_WEB_REQUEST > 1000){
                              ifclick = "yes"
                              if (PLANE_BEING_VIEWED == flightid && Date.now() - LAST_WEB_REQUEST < 100000){
                                newRequest = 'false'
                              } else {
                                PLANE_BEING_VIEWED = flightid
                                newRequest = 'true'
                              }
                              LAST_WEB_REQUEST = Date.now()
                              dataForGraph = []
                              dataForGraphSpeed = []
                              labels = []
                              airportaltforglobe = 'none'
                              var globeflightid = flightid
                              var globelink = ''
                              var xhr = new XMLHttpRequest()
                              xhr.open('GET', "https://api.infiniteview.app/flightDetails?apikey=ZNvNHJYC5IcLYUMlFpBI&flightid=" + flightid + '&new=' + newRequest, true);
                              xhr.send();
                              xhr.addEventListener("readystatechange", processRequest, false);
                              function processRequest(e) {
                              if (xhr.readyState == 4 && xhr.status == 200) {
                                  var latlonglist = []
                                  // now load in user details
                                  userDetails = JSON.parse(xhr.responseText)['userInfo']
                                  if (userDetails == {}){
                                    userDetails = {"flightTime": '>0',
                                                    "grade": '??',
                                                    "landingCount": '??',
                                                    "onlineFlights": '>0',
                                                    "violations": '0?🤞',
                                                    "xp": '??'}
                                  }
                                  if (marker.username){
                                    document.getElementById('user-title').innerHTML = marker.username + "'s Profile"
                                  } else {
                                    document.getElementById('user-title').innerHTML = "Guest's Profile"
                                  }
                                  // Flightplan handling
                                  if (newRequest == 'true'){
                                    waypoints = JSON.parse(xhr.responseText)['flightInfo'][0]['flightPlan']
                                  }
                                  renderWaypoints()

                                  allowEditingScheduledTimes = false;
                                  document.getElementById('flight-secret').style.display = 'none'
                                  PREVIOUS_FLIGHTS_LINK = 'https://api.infiniteview.app/previous-flights?apikey=ZNvNHJYC5IcLYUMlFpBI&userid='+marker.userid
                                  if (localStorage.getItem('InfiniteFlightPairing') !== null) {
                                    if (marker.userid == localStorage.getItem('InfiniteFlightPairing').split('.')[0]){
                                      document.getElementById("flight-info-panel").style.display = 'block'
                                      document.getElementById('pair-button').style.display = 'block'

                                      document.getElementById('flight-secret').innerHTML = 'Discord Secret: ' + flightid
                                      document.getElementById('flight-secret').style.display = 'block'
                                      document.getElementById('pair-button').innerHTML = "<svg width='30' height='30' viewBox='0 0 24 24' fill='none' xmlns='http://www.w3.org/2000/svg'><circle cx='12' cy='12' r='10' fill='#4CAF50'/><path d='M9 12.6L11.1 14.7L15.3 10.5' stroke='white' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'/></svg>"
                                      document.getElementById("pair-button").onclick = function() {
                                        return 1;
                                      };
                                      allowEditingScheduledTimes = true;
                                      editFid = flightid
                                      enableEditing()
                                    } else {
                                      if (marker.userid){
                                        document.getElementById('pair-button').style.display = 'block'
                                        document.getElementById('pair-button').innerHTML = 'Pair'
                                        document.getElementById("pair-button").onclick = function() {
                                          window.open("https://infiniteview.app/verify-flight?user="+marker.userid+"&name="+marker.username, "_blank");
                                        };
                                      } else {
                                        document.getElementById('pair-button').style.display = 'none'
                                      }

                                      editFid = ''
                                      disableEditing()
                                    }
                                  } else {
                                    if (marker.userid){
                                      document.getElementById('pair-button').style.display = 'block'
                                      document.getElementById('pair-button').innerHTML = 'Pair'
                                      document.getElementById("pair-button").onclick = function() {
                                        window.open("https://infiniteview.app/verify-flight?user="+marker.userid+"&name="+marker.username, "_blank");
                                      };
                                    } else {
                                      document.getElementById('pair-button').style.display = 'none'
                                    }
                                  }
                                  const notifKey = 'notifications';
                                  let notifications = [];

                                  try {
                                    const raw = localStorage.getItem(notifKey);
                                    if (raw) {
                                      const cleaned = raw.trim(); // removes invisible whitespace
                                      notifications = JSON.parse(cleaned);
                                    }
                                  } catch (e) {
                                    console.error("Failed to parse notifications from localStorage:", e);
                                    notifications = [];
                                    localStorage.removeItem(notifKey); // optional: reset corrupt data
                                  }


                                  if (notifications.includes(marker.flightid)) {
                                      document.getElementById('notification-button').innerHTML = '🔔';
                                      document.getElementById('notification-button').onclick = function () {
                                          disableNotifications(marker.flightid);
                                          console.log('ran disable');

                                          // Remove the flight ID
                                          notifications = notifications.filter(item => item !== marker.flightid);
                                          localStorage.setItem(notifKey, JSON.stringify(notifications));
                                      };
                                  } else {
                                      document.getElementById('notification-button').innerHTML = '🔕';
                                      document.getElementById('notification-button').onclick = function () {
                                          enableNotifications(marker.flightid);
                                          console.log('ran enable');
                                          document.getElementById('notification-overlay').classList.add('active');
                                          if (!notifications.includes(marker.flightid)) {
                                              notifications.push(marker.flightid);
                                              localStorage.setItem(notifKey, JSON.stringify(notifications));
                                          }
                                      };
                                  }
                                  document.getElementById('aircraftimage').innerHTML = "<img style='width: 100%; height: 100%;' src='https://cdn.infiniteview.app/"+marker.liveryId+".jpg' onerror=\"this.onerror=null; this.src='https://cdn.infiniteview.app/unknown.jpg';\"></img><span class='credits'>&copy; "+marker.credit+"</span><span onclick='generateShare()' class='credits' id='sharebutton' style='cursor: pointer; left: auto; right: 5px; border-radius: 5px;'>🔗</span>"
                                  document.getElementById('aircraftimage').style.display = 'block'
                                  document.getElementById('2Box').style.borderRadius = '0px 0px 10px 10px'
                                  document.getElementById('8box').style = 'margin: 0px; display: block; max-height: 1000px;'
                                  document.getElementById('81Text').innerHTML = numberWithCommas(userDetails['xp'])
                                  document.getElementById('82Text').innerHTML = numberWithCommas(userDetails['violations'])
                                  document.getElementById('91Text').innerHTML = numberWithCommas(Math.round(userDetails['flightTime']/60))
                                  document.getElementById('92Text').innerHTML = numberWithCommas(userDetails['landingCount'])
                                  document.getElementById('101Text').innerHTML = numberWithCommas(userDetails['grade'])
                                  document.getElementById('102Text').innerHTML = numberWithCommas(userDetails['onlineFlights'])
                                  response = JSON.parse(xhr.responseText)['flightInfo'];
                                  if (newRequest == 'true'){
                                    PLANE_BEING_VIEWED_DETAILS = JSON.parse(xhr.responseText)['flightInfo'];
                                  } else {
                                    PLANE_BEING_VIEWED_DETAILS[0] = response[0]
                                    PLANE_BEING_VIEWED_DETAILS.push(response[1])
                                    response = PLANE_BEING_VIEWED_DETAILS
                                  }
                                  var aLat = ''
                                  var aLong = ''
                                  startAirport = ''
                                  endAirport = ''
                                  document.getElementById("departure-airport").innerHTML = "<span style='font-size: 32px; color: white;'>N/A<sup style='font-size: 14px;'>[XX:XX]</sup></span>"
                                  document.getElementById("arrival-airport").innerHTML = "<span style='font-size: 32px; color: white;'><sup style='font-size: 14px;'>[XX:XX]</sup>N/A</span>"
                                  if (!(flightid in inboundFlightsDict)){
                                    if (response[0].Diversion){
                                      endAirport = response[0].Diversion.split(' ')[0]
                                    }
                                  } else {
                                    endAirport = inboundFlightsDict[flightid]
                                  }
                                  try{
                                    aLat = AIRPORT_LOCATION_DATA[endAirport]['coordinates'].split(',')[0]
                                    aLong = AIRPORT_LOCATION_DATA[endAirport]['coordinates'].split(', ')[1]
                                    airportaltforglobe = AIRPORT_LOCATION_DATA[endAirport]['elevation_ft']
                                    progress = getDistanceFromLatLonInKm(lat, long, aLat, aLong)
                                    // ^ before in case start not defined.
                                    startAirport = outboundFlightsDict[flightid]
                                    if (startAirport == null){
                                      startAirport = response[0].Departure
                                    }
                                    oLat = AIRPORT_LOCATION_DATA[startAirport]['coordinates'].split(',')[0]
                                    oLong = AIRPORT_LOCATION_DATA[startAirport]['coordinates'].split(', ')[1]

                                    delayedCheck = false
                                    now = new Date()
                                    // Predicted arrival

                                    timeToFlyPred = progress / (speed * 1.852)
                                    if (speed > 50){
                                      let timeInMinutes = parseInt(timeToFlyPred * 60);
                                      let displayText;

                                      if (timeInMinutes >= 60) {
                                        const hrs = Math.floor(timeInMinutes / 60);
                                        const mins = timeInMinutes % 60;

                                        displayText = hrs + (hrs === 1 ? " hr" : " hrs");
                                        if (mins > 0) {
                                          displayText += " " + mins + (mins === 1 ? " min" : " mins");
                                        }
                                      } else {
                                        displayText = timeInMinutes + (timeInMinutes === 1 ? " min" : " mins");
                                      }

                                      document.getElementById('51Text').innerHTML = displayText;
                                    } else {
                                      document.getElementById('51Text').innerHTML = '---'
                                    }
                                    numberOfMlSeconds = now.getTime();
                                    addMlSeconds = 60 * 60 * 1000 * (timeToFlyPred);
                                    newDateObj4 = new Date(numberOfMlSeconds + addMlSeconds);

                                    predictedArrival = (newDateObj4.getHours() < 10 ? "0" : "") + newDateObj4.getHours() + ":" + (newDateObj4.getMinutes() < 10 ? "0" : "") + newDateObj4.getMinutes()
                                    if (speed < 100){
                                      predictedArrival = 'Pending'
                                    }

                                    // Scheduled arrival

                                    spawnTime = response[0]['Timings'][0]*1000

                                    timePassed = (now.getTime() - spawnTime)/(60*1000)
                                    customised = false
                                    dist = getDistanceFromLatLonInKm(oLat, oLong, aLat, aLong)
                                    timeToFly = (dist / 890) + 0.75
                                    //timePassed = response.length / 120
                                    progress = Math.max(0,(1 - (progress / dist))*100)
                                    t = timeToFly - timePassed
                                    addMlSeconds = 60 * 60 * 1000 * (t);
                                    newDateObj3 = new Date(spawnTime + 20*60*1000 + timeToFly*3600*1000);
                                    newDateObj3 = roundToNearestFiveMinutes(newDateObj3)
                                    if (response[0].custom && response[0].custom[1] != 123){
                                      newDateObj3 = new Date(parseInt(response[0].custom[1], 10))
                                      customised = true
                                    } else {
                                      newDateObj3 = new Date(spawnTime + 20*60*1000 + timeToFly*3600*1000);
                                      newDateObj3 = roundToNearestFiveMinutes(newDateObj3)
                                    }
                                    scheduledArrival = (newDateObj3.getHours() < 10 ? "0" : "") + newDateObj3.getHours() + ":" + (newDateObj3.getMinutes() < 10 ? "0" : "") + newDateObj3.getMinutes()
                                    // Scheduled Departure
                                    if (timePassed > 0.3){
                                      delta_t = 0.36 - timePassed
                                    } else{
                                      delta_t = (40-response.length)/120
                                    }
                                    addMlSeconds = 60 * 60 * 1000 * (delta_t);
                                    newDateObj = new Date(spawnTime + 20*60*1000)
                                    newDateObj = roundToNearestFiveMinutes(newDateObj)
                                    //newDateObj = new Date(numberOfMlSeconds + addMlSeconds);
                                    if (response[0].custom && response[0].custom[0] != 123){
                                      newDateObj = new Date(parseInt(response[0].custom[0], 10))
                                    } else {
                                      newDateObj = new Date(spawnTime + 20*60*1000)
                                      newDateObj = roundToNearestFiveMinutes(newDateObj)
                                    }
                                    scheduledDeparture = (newDateObj.getHours() < 10 ? "0" : "") + newDateObj.getHours() + ":" + (newDateObj.getMinutes() < 10 ? "0" : "") + newDateObj.getMinutes()
                                    // Find actual departure
                                    stamp = 0
                                    for (i=response.length-1; i>=1; i--){
                                      if (['Taking off' , 'Climbing'].includes(response[i].Status)){
                                        if (response[i-1].Status === 'On the ground'){
                                          stamp = i
                                          break
                                        }
                                      }
                                    }
                                    if (response[0]['Timings'][1] != 0){
                                      newDateObjTwo = new Date(response[0]['Timings'][1]*1000)
                                      if (newDateObjTwo > new Date(spawnTime + 20*60*1000+ 60000)){
                                        delayedCheck = true
                                      }
                                      actualDeparture = (newDateObjTwo.getHours() < 10 ? "0" : "") + newDateObjTwo.getHours() + ":" + (newDateObjTwo.getMinutes() < 10 ? "0" : "") + newDateObjTwo.getMinutes()
                                    } else {
                                      actualDeparture = 'Pending'
                                      if (newDateObj < new Date()){
                                        delayedCheck = true
                                      }
                                    }

                                    // now change delay to on time if within 2 hours of airport, and on-time
                                    if (timeToFlyPred < 2){
                                      if (newDateObj4 < newDateObj3){
                                        delayedCheck = false
                                      } else {
                                        delayedCheck = true
                                      }
                                    }

                                    if (response[0]['Timings'][2] > 0 && getDistanceFromLatLonInKm(lat, long, aLat, aLong) < 10){
                                      newDateObj = new Date(response[0]['Timings'][2]*1000)
                                      if (newDateObj < newDateObj3){
                                        delayedCheck = false
                                      }
                                      actualArrival = (newDateObj.getHours() < 10 ? "0" : "") + newDateObj.getHours() + ":" + (newDateObj.getMinutes() < 10 ? "0" : "") + newDateObj.getMinutes()
                                    } else{
                                      actualArrival = 'Pending'
                                    }

                                    start_iata = AIRPORT_LOCATION_DATA[startAirport]['iata_code']
                                    end_iata = AIRPORT_LOCATION_DATA[endAirport]['iata_code']
                                    start_municipality = AIRPORT_LOCATION_DATA[startAirport]['municipality']
                                    end_municipality = AIRPORT_LOCATION_DATA[endAirport]['municipality']
                                    //constuct globe link
                                    if (startAirport != 'none'){
                                      playbacklink = 'https://infiniteview.app/playbackTest?tfid='+flightid+'&start='+startAirport+'&end='+endAirport+'&callsign='+marker.callsign
                                      //globelink = 'https://infiniteview.app/'+GLOBAL_LOCATION+'?flightid=' + globeflightid + '&serverid=' + serverid + '&airportalt=' + airportaltforglobe + '&globedelay=' + globedelay
                                      document.getElementById('globebox').style.display = 'none'
                                      //document.getElementById('globebox').style = 'margin: 0px; background: #1f1f1f; padding: 2px; display: block; border-radius: 12px;'
                                      //document.getElementById("globetext").innerHTML = "<a href="+playbacklink+", target='_blank'>Flight playback 📹</a>"
                                    }
                                    if (downloadKey != 'twoplustwoisfour'){
                                      document.getElementById("globebox").style.display = 'block'
                                      document.getElementById("globebox").innerHTML = "<a onclick='downloadLink()' style='font-size:10px; text-align: center; padding: 0px;'>Download flight path (KML)</p>"
                                    }
                                    // need to do some tweaking for multi flights
                                    if (actualDeparture != 'Pending' && actualArrival == 'Pending'){
                                      if (getDistanceFromLatLonInKm(lat, long, oLat, oLong)< 5){
                                        // at new departure airport
                                        actualDeparture = 'Pending'
                                        actualArrival = 'Pending'
                                        scheduledArrival = 'CALC'
                                        scheduledDeparture = 'CALC'
                                      }
                                    }
                                    // now detect flight resume
                                    if (response[0]['Altitude'] >= 28000 && response[0]['Timings'][1] == 0){
                                      actualDeparture = 'Pending'
                                      actualArrival = 'Pending'
                                      scheduledArrival = '????'
                                      scheduledDeparture = '????'
                                    }

                                    // Generate top graphic

                                    if (response[0]['Diversion'].split(' ').length == 3){
                                      if (response[0]['Diversion'].split(' ')[0] == startAirport){
                                        response[0]['Diversion'] = response[0]['Diversion'].split(' ')[2]
                                      }
                                    }
                                    const diversionNotice = document.getElementById('diversionNotice');
                                    const arrivalAirport = document.getElementById('arrival-airport');
                                    const statusBadge = document.getElementById('statusBadge');
                                    const progressFill = document.getElementById('progressFill');
                                    const aircraftIcon = document.getElementById('aircraftIcon');
                                    const arrivalPoint = document.getElementById('arrivalPoint');
                                    progressFill.style.width = progress + '%';
                                    aircraftIcon.style.left = Math.min(99, Math.max(1, progress)) + '%';


                                    if (response[0]['Diversion'].split(' ').length == 3){
                                      diversion_name = AIRPORT_LOCATION_DATA[response[0]['Diversion'].split(' ')[2]]['name']
                                      diversion_iata = AIRPORT_LOCATION_DATA[response[0]['Diversion'].split(' ')[2]]['iata_code']
                                      original_iata = AIRPORT_LOCATION_DATA[response[0]['Diversion'].split(' ')[0]]['iata_code']
                                      diversionNotice.classList.add('show');
                                      arrivalAirport.style.opacity = 0.2
                                      progressFill.classList.add('diverted');
                                      aircraftIcon.classList.add('diverted');
                                      arrivalPoint.classList.add('diversion');
                                      document.getElementById('diversion-code').innerHTML = diversion_iata
                                      document.getElementById('diversion-name').innerHTML = diversion_name
                                      if (predictedArrival != 'Pending'){
                                        document.getElementById('diversion-time').innerHTML = 'ETA ' + predictedArrival
                                      } else {
                                        document.getElementById('diversion-time').innerHTML = 'Arrived'
                                      }
                                      predictedArrival = '--:--'
                                      end_iata = original_iata
                                    } else {
                                      if (diversionNotice.classList.contains('show')){
                                        diversionNotice.classList.remove('show');
                                        arrivalAirport.style.opacity = 1
                                        progressFill.classList.remove('diverted');
                                        aircraftIcon.classList.remove('diverted');
                                        arrivalPoint.classList.remove('diversion');
                                      }
                                    }
                                    document.getElementById("departure-airport").innerHTML = "<span style='font-size: 32px; color: white;'>"+start_iata+" <sup style='font-size: 14px;'>["+scheduledDeparture+"]</sup></span>"
                                    document.getElementById("arrival-airport").innerHTML = "<span style='font-size: 32px; color: white;'><sup style='font-size: 14px;'>["+scheduledArrival+"]</sup> "+end_iata+"</span>"
                                    document.getElementById('departure-time').innerHTML = 'Actual ('+actualDeparture+')'
                                    if (actualArrival == 'Pending'){
                                      document.getElementById('arrival-time').innerHTML = 'Estimated ('+predictedArrival+')'
                                    } else {
                                      document.getElementById('arrival-time').innerHTML = 'Actual ('+actualArrival+')'
                                    }

                                    if (delayedCheck == true){
                                      document.getElementById('52Text').style.color = '#ff6961'
                                      document.getElementById('52Text').innerHTML = 'Delayed'
                                    } else {
                                      document.getElementById('52Text').style.color = '#C1E1C1'
                                      document.getElementById('52Text').innerHTML = 'On time'
                                    }

                                    if (response[0]['Altitude'] >= 28000 && response[0]['Timings'][1] == 0){
                                      document.getElementById('52Text').style.color = '#FFFFFF'
                                      document.getElementById('52Text').innerHTML = 'Resume'
                                    }
                                  } catch (err){
                                      console.log(err)
                                    }


                                    function addLineSegments(segments) {
                                      // Skip processing if no segments
                                      if (!segments || segments.length === 0) {
                                          return;
                                      }

                                      // Make a working copy to avoid modifying the original data
                                      const workingSegments = JSON.parse(JSON.stringify(segments));

                                      // Calculate headings for all segments first
                                      for (let i = 0; i < workingSegments.length; i++) {
                                          const segment = workingSegments[i];
                                          const start = [segment.start.lng, segment.start.lat];
                                          const end = [segment.end.lng, segment.end.lat];

                                          // Store coordinates as arrays for later use
                                          segment.startCoords = start;
                                          segment.endCoords = end;

                                          // Calculate and store heading
                                          segment.heading = turf.bearing(start, end);
                                      }

                                      // Calculate heading changes for all segments
                                      for (let i = 1; i < workingSegments.length; i++) {
                                          const prevSegment = workingSegments[i-1];
                                          const currentSegment = workingSegments[i];

                                          // Calculate heading difference
                                          let headingDiff;
                                          if (prevSegment.speed < 50){
                                            headingDiff = 0
                                          } else {
                                            headingDiff = currentSegment.heading - prevSegment.heading;
                                          }

                                          // Normalize to -180 to 180 range
                                          if (headingDiff > 180) headingDiff -= 360;
                                          if (headingDiff < -180) headingDiff += 360;

                                          // Store heading change
                                          currentSegment.headingChange = headingDiff;
                                      }

                                      // First segment has no heading change
                                      if (workingSegments.length > 0) {
                                          workingSegments[0].headingChange = 0;
                                      }

                                      // Create GeoJSON features
                                      const features = workingSegments.map((segment, index) => {
                                          const headingChange = segment.headingChange || 0;

                                          // Determine if this segment should have a curve
                                          const shouldCurve = !segment.dashed &&
                                                             (segment.speed > 50) &&
                                                             (Math.abs(headingChange) > 10) &&
                                                             (segment.altitude < 29000) &&
                                                             (!document.hidden);

                                          let geometry;

                                          if (shouldCurve) {
                                              // Calculate curve parameters
                                              const turnDirection = headingChange > 0 ? 1 : -1;
                                              const turnSharpness = Math.min(1, Math.abs(headingChange) / 90);
                                              const curveAmount = turnDirection * 0.15 * turnSharpness;

                                              // Adjust midpoint position based on turn sharpness
                                              const midpointPosition = 0.5 - (turnSharpness * 0.2);

                                              const start = segment.startCoords;
                                              const end = segment.endCoords;

                                              // Calculate midpoint
                                              const midX = start[0] + (end[0] - start[0]) * midpointPosition;
                                              const midY = start[1] + (end[1] - start[1]) * midpointPosition;

                                              // Create perpendicular offset for curve
                                              const dx = end[0] - start[0];
                                              const dy = end[1] - start[1];

                                              // Create offset midpoint
                                              const midpoint = [
                                                  midX - dy * curveAmount,
                                                  midY + dx * curveAmount
                                              ];

                                              // Create and smooth the curve
                                              const line = turf.lineString([start, midpoint, end]);
                                              const curved = turf.bezierSpline(line, {
                                                  resolution: 5000,
                                                  sharpness: 0.85
                                              });

                                              geometry = curved.geometry;
                                          } else {
                                              // Create a straight great circle path
                                              try {
                                                  // Use the pre-calculated coordinate arrays
                                                  geometry = turf.greatCircle(
                                                      segment.startCoords,
                                                      segment.endCoords
                                                  ).geometry;
                                              } catch (e) {
                                                  // Fallback if greatCircle fails
                                                  console.error("Error creating great circle line:", e);
                                                  geometry = turf.lineString([
                                                      segment.startCoords,
                                                      segment.endCoords
                                                  ]).geometry;
                                              }
                                          }

                                          // Return the feature
                                          return {
                                              type: 'Feature',
                                              geometry: geometry,
                                              properties: {
                                                  id: `line-${index}`,
                                                  color: segment.color,
                                                  dashed: segment.dashed
                                              }
                                          };
                                      });

                                      // Create feature collection
                                      const featureCollection = {
                                          type: 'FeatureCollection',
                                          features: features
                                      };

                                      // Add or update the source
                                      try {
                                          if (!map.getSource('lines-source')) {
                                              map.addSource('lines-source', {
                                                  type: 'geojson',
                                                  data: featureCollection
                                              });
                                          } else {
                                              map.getSource('lines-source').setData(featureCollection);
                                          }

                                          // Add or update the layer
                                          if (!map.getLayer('lines-layer')) {
                                              map.addLayer({
                                                  id: 'lines-layer',
                                                  type: 'line',
                                                  source: 'lines-source',
                                                  layout: {
                                                      'line-join': 'round',
                                                      'line-cap': 'round'
                                                  },
                                                  paint: {
                                                      'line-color': [
                                                          'case',
                                                          ['==', ['get', 'dashed'], true],
                                                          '#000000',
                                                          ['get', 'color']
                                                      ],
                                                      'line-width': 3,
                                                      'line-dasharray': [
                                                          'case',
                                                          ['==', ['get', 'dashed'], true],
                                                          [2, 2],
                                                          [1, 0]
                                                      ]
                                                  }
                                              }, 'planes-layer');
                                          } else {
                                              // Update paint properties
                                              map.setPaintProperty('lines-layer', 'line-color', [
                                                  'case',
                                                  ['==', ['get', 'dashed'], true],
                                                  '#000000',
                                                  ['get', 'color']
                                              ]);
                                              map.setPaintProperty('lines-layer', 'line-dasharray', [
                                                  'case',
                                                  ['==', ['get', 'dashed'], true],
                                                  [2, 2],
                                                  [1, 0]
                                              ]);
                                          }
                                      } catch (e) {
                                          console.error("Error adding line segments to map:", e);
                                      }
                                  }

                                  //document.getElementById("rcorners3").innerHTML = 'Flying from ' + startAirport + ' to ' + endAirport + ' and will arrive at ' + predictedArrival + ' but is scheduled for ' + scheduledArrival + '. ' + response[0]['Time'] + '. Scheduled departure ' + scheduledDeparture + ', actual departure' + actualDeparture
                                  flightpathlist = []
                                  graphPoints = [];
                                  chartPoints = [];
                                  let altitudeSeries = [];
                                  let speedSeries = [];
                                  let downsampleFactor = 1;

                                  for (i = 0; i < response.length; i++) {
                                    const pointTimestamp = response[i].Timestamp ?
                                      parseInt(response[i].Timestamp) * 1000 :
                                      (graphPoints.length ? graphPoints[graphPoints.length - 1].timestamp + 1000 : Date.now());

                                    const altitudeValue = parseInt(response[i].Altitude);
                                    const speedValue = parseInt(response[i].Speed);

                                    graphPoints.push({
                                      altitude: altitudeValue,
                                      speed: speedValue,
                                      lat: response[i].Latitude,
                                      lng: response[i].Longitude,
                                      timestamp: pointTimestamp
                                    });

                                    // Function to interpolate between colors based on altitude
                                    function getAltitudeColor(altitude) {
                                      // Define our color stops with altitude boundaries
                                      const colorStops = [
                                        { altitude: 0, color: "#ffffff" },     // Sea level - white
                                        { altitude: 300, color: "#ffffff" },   // Start with white up to 300m
                                        { altitude: 1200, color: "#ffff99" },  // Light yellow
                                        { altitude: 3200, color: "#9efc35" },  // Green
                                        { altitude: 7200, color: "#52f78f" },  // Teal-green
                                        { altitude: 11200, color: "#54f8e8" }, // Cyan
                                        { altitude: 15200, color: "#54dbfa" }, // Light blue
                                        { altitude: 21200, color: "#4d7df9" }, // Medium blue
                                        { altitude: 27200, color: "#4e3ef8" }, // Dark blue
                                        { altitude: 31200, color: "#760cd1" }, // Purple
                                        { altitude: 37200, color: "#a10cc1" }, // Magenta
                                        { altitude: 42200, color: "#eb0860" }, // Pink-red
                                        { altitude: 42900, color: "#ff0a24" }, // Red
                                        { altitude: 45200, color: "#ff0b1c" }, // Dark red
                                        { altitude: 48000, color: "#ff0910" }  // Very dark red
                                      ];

                                      // If below first or above last stop, use those colors
                                      if (altitude < colorStops[0].altitude) return colorStops[0].color;
                                      if (altitude >= colorStops[colorStops.length - 1].altitude) return colorStops[colorStops.length - 1].color;

                                      // Find the two color stops we need to interpolate between
                                      let lowerIndex = 0;
                                      for (let i = 0; i < colorStops.length - 1; i++) {
                                        if (altitude >= colorStops[i].altitude && altitude < colorStops[i + 1].altitude) {
                                          lowerIndex = i;
                                          break;
                                        }
                                      }

                                      const lowerStop = colorStops[lowerIndex];
                                      const upperStop = colorStops[lowerIndex + 1];

                                      // Calculate how far we are between the two stops (0.0 to 1.0)
                                      const ratio = (altitude - lowerStop.altitude) / (upperStop.altitude - lowerStop.altitude);

                                      // Parse the hex colors to RGB
                                      const lowerColor = {
                                        r: parseInt(lowerStop.color.substring(1, 3), 16),
                                        g: parseInt(lowerStop.color.substring(3, 5), 16),
                                        b: parseInt(lowerStop.color.substring(5, 7), 16)
                                      };

                                      const upperColor = {
                                        r: parseInt(upperStop.color.substring(1, 3), 16),
                                        g: parseInt(upperStop.color.substring(3, 5), 16),
                                        b: parseInt(upperStop.color.substring(5, 7), 16)
                                      };

                                      // Interpolate between the colors
                                      const interpolatedColor = {
                                        r: Math.round(lowerColor.r + ratio * (upperColor.r - lowerColor.r)),
                                        g: Math.round(lowerColor.g + ratio * (upperColor.g - lowerColor.g)),
                                        b: Math.round(lowerColor.b + ratio * (upperColor.b - lowerColor.b))
                                      };

                                      // Convert back to hex
                                      return "#" +
                                        interpolatedColor.r.toString(16).padStart(2, '0') +
                                        interpolatedColor.g.toString(16).padStart(2, '0') +
                                        interpolatedColor.b.toString(16).padStart(2, '0');
                                    }

                                    var line_colour = getAltitudeColor(response[i].Altitude)
                                    flightpathlist.push({lat: response[i].Latitude, lng: response[i].Longitude, color: line_colour, altitude: response[i].Altitude})
                                 }

                                 // Clean and sort graph points to ensure the chart only plots valid data
                                 graphPoints = graphPoints
                                   .filter(point => Number.isFinite(point.altitude) && Number.isFinite(point.speed))
                                   .sort((a, b) => a.timestamp - b.timestamp);

                                // Trim trailing zeroed points that cause the charts to drop to zero at the end
                                while (graphPoints.length && graphPoints[graphPoints.length - 1].altitude === 0 && graphPoints[graphPoints.length - 1].speed === 0) {
                                  graphPoints.pop();
                                }

                                if (graphPoints.length > 80) {
                                  downsampleFactor = Math.max(1, parseInt(graphPoints.length / 80));
                                }

                                 graphPoints.forEach((point, index) => {
                                   if (downsampleFactor === 1 || index % downsampleFactor === 0 || index === graphPoints.length - 1) {
                                     altitudeSeries.push({ x: point.timestamp, y: point.altitude, originalIndex: index });
                                     speedSeries.push({ x: point.timestamp, y: point.speed, originalIndex: index });
                                   }
                                 });
                                 formatted = []
                                 for (i=0; i<response.length-1; i++){
                                   if (response[i].Longitude * response[i+1].Longitude >= -50){
                                     if (response[i].Altitude > 27500 && response[i].Speed == 0){
                                       response[i].Speed = response[i-1].Speed
                                     }
                                     formatted.push({start: {lat: response[i].Latitude, lng: response[i].Longitude},
                                                     end: {lat: response[i+1].Latitude, lng: response[i+1].Longitude},
                                                     color: flightpathlist[i].color,
                                                     dashed: false,
                                                     altitude: response[i].Altitude,
                                                     speed: response[i].Speed})
                                   }
                                 }
                                 formatted[formatted.length-1].end = {lat: marker.location[0], lng: marker.location[1]}

                                 if (aLat != ''){
                                   if (showFlightPlan == false){
                                     if (getDistanceFromLatLonInKm(lat, long, aLat, aLong) > 10){
                                       formatted.push({start: {lat: lat, lng: long},
                                                       end: {lat: aLat, lng: aLong},
                                                       color: 'black',
                                                       dashed: true,
                                                       altitude: 0,
                                                       speed: 0})
                                     }
                                   }
                                 }
                                 if (map.getLayer('lines-layer')){
                                   map.removeLayer('lines-layer')
                                   map.removeSource('lines-source')
                                   map.removeLayer('flight-path-3d')
                                 }
                                 function createFlightPathLayer(map, segments, layerId = 'flight-path-3d') {
                                   // Add the custom layer for threebox

                                     if (map.getLayer('flight-path-3d')){
                                        const layer = map.getLayer('flight-path-3d');
                                        const layerImpl = map.style._layers['flight-path-3d'];

                                        // Clean up threebox if it exists
                                        if (layerImpl && layerImpl.implementation && layerImpl.implementation.tb) {
                                            const tb = layerImpl.implementation.tb;
                                            if (tb.clear) tb.clear(); // Clear all objects
                                            if (tb.dispose) tb.dispose(); // Dispose threebox
                                        }
                                        map.removeLayer('flight-path-3d')
                                     }

                                     map.addLayer({
                                         id: layerId,
                                         type: 'custom',
                                         renderingMode: '3d',
                                         onAdd: function (map, gl) {
                                             // Initialize threebox

                                             this.tb = new Threebox(
                                                 map,
                                                 gl,
                                                 {
                                                     defaultLights: true,
                                                     enableSelectingFeatures: true,
                                                     enableSelectingObjects: true,
                                                     enableDraggingObjects: false,
                                                     enableRotatingObjects: false,
                                                     enableTooltips: false
                                                 }
                                             );
                                             tbInstance = this.tb;
                                             // Create flight path geometry
                                             this.createFlightPath(segments);
                                         },

                                         render: function (gl, matrix) {
                                             this.tb.update();
                                         },


                                         createFlightPath: function(segments) {
                                           if (flightpaths3D === true){
                                             if (!segments || segments.length < 2) {
                                                 console.warn('Need at least 2 segments to create flight path');
                                                 return;
                                             }

                                             // Helper function to check if line crosses antimeridian (180°/-180° longitude)
                                             function crossesAntimeridian(lng1, lng2) {
                                                 return Math.abs(lng2 - lng1) > 180;
                                             }

                                             // Helper function to create intermediate points when crossing antimeridian
                                             function createAntimeridianSegments(prevSeg, currSeg) {
                                                 const segments = [];

                                                 // Determine which direction is shorter
                                                 let lng1 = prevSeg.lng;
                                                 let lng2 = currSeg.lng;

                                                 if (lng2 - lng1 > 180) {
                                                     // Going west is shorter, adjust lng2
                                                     lng2 -= 360;
                                                 } else if (lng1 - lng2 > 180) {
                                                     // Going east is shorter, adjust lng1
                                                     lng1 -= 360;
                                                 }

                                                 // Calculate the interpolation factor for the antimeridian crossing
                                                 const totalLngDiff = lng2 - lng1;
                                                 const altDiff = (currSeg.altitude || 0) - (prevSeg.altitude || 0);

                                                 if (prevSeg.lng > 0 && currSeg.lng < 0) {
                                                     // Crossing from positive to negative (going east)
                                                     const factor = (180 - prevSeg.lng) / Math.abs(totalLngDiff);
                                                     const crossingAlt = (prevSeg.altitude || 0) + (altDiff * factor);

                                                     // First segment: previous point to +180
                                                     segments.push({
                                                         geometry: [
                                                             [prevSeg.lng, prevSeg.lat, (prevSeg.altitude || 0) * 0.3048],
                                                             [180, prevSeg.lat + (currSeg.lat - prevSeg.lat) * factor, crossingAlt * 0.3048]
                                                         ]
                                                     });

                                                     // Second segment: -180 to current point
                                                     segments.push({
                                                         geometry: [
                                                             [-180, prevSeg.lat + (currSeg.lat - prevSeg.lat) * factor, crossingAlt * 0.3048],
                                                             [currSeg.lng, currSeg.lat, (currSeg.altitude || 0) * 0.3048]
                                                         ]
                                                     });
                                                 } else if (prevSeg.lng < 0 && currSeg.lng > 0) {
                                                     // Crossing from negative to positive (going west)
                                                     const factor = (prevSeg.lng + 180) / Math.abs(totalLngDiff);
                                                     const crossingAlt = (prevSeg.altitude || 0) + (altDiff * factor);

                                                     // First segment: previous point to -180
                                                     segments.push({
                                                         geometry: [
                                                             [prevSeg.lng, prevSeg.lat, (prevSeg.altitude || 0) * 0.3048],
                                                             [-180, prevSeg.lat + (currSeg.lat - prevSeg.lat) * factor, crossingAlt * 0.3048]
                                                         ]
                                                     });

                                                     // Second segment: +180 to current point
                                                     segments.push({
                                                         geometry: [
                                                             [180, prevSeg.lat + (currSeg.lat - prevSeg.lat) * factor, crossingAlt * 0.3048],
                                                             [currSeg.lng, currSeg.lat, (currSeg.altitude || 0) * 0.3048]
                                                         ]
                                                     });
                                                 } else {
                                                     // Normal case - no antimeridian crossing needed
                                                     segments.push({
                                                         geometry: [
                                                             [prevSeg.lng, prevSeg.lat, (prevSeg.altitude || 0) * 0.3048],
                                                             [currSeg.lng, currSeg.lat, (currSeg.altitude || 0) * 0.3048]
                                                         ]
                                                     });
                                                 }

                                                 return segments;
                                             }

                                             // Draw line segments between consecutive points
                                             for (let i = 1; i < segments.length; i++) {
                                                 const currentSegment = segments[i];
                                                 const previousSegment = segments[i - 1];

                                                 // Check if this segment crosses the antimeridian
                                                 if (crossesAntimeridian(previousSegment.lng, currentSegment.lng)) {
                                                     // Create multiple segments to handle antimeridian crossing
                                                     const lineSegments = createAntimeridianSegments(previousSegment, currentSegment);

                                                     lineSegments.forEach(segmentData => {
                                                         const line_segment = this.tb.line({
                                                             geometry: segmentData.geometry,
                                                             color: currentSegment.color || '#ff0000',
                                                             width: 3,
                                                             opacity: 1
                                                         });

                                                         if (localStorage.getItem('mapProjection') != 'globe') {
                                                             this.tb.add(line_segment);
                                                         }
                                                     });
                                                 } else {
                                                     // Normal segment - no antimeridian crossing
                                                     const line_segment = this.tb.line({
                                                         geometry: [
                                                             [previousSegment.lng, previousSegment.lat, (previousSegment.altitude || 0) * 0.3048],
                                                             [currentSegment.lng, currentSegment.lat, (currentSegment.altitude || 0) * 0.3048]
                                                         ],
                                                         color: currentSegment.color || '#ff0000',
                                                         width: 3,
                                                         opacity: 1
                                                     });

                                                     if (localStorage.getItem('mapProjection') != 'globe') {
                                                         this.tb.add(line_segment);
                                                     }
                                                 }

                                                 // Draw vertical line at the previous point (drop line to ground)
                                                 const line_vertical = this.tb.line({
                                                     geometry: [
                                                         [previousSegment.lng, previousSegment.lat, (previousSegment.altitude || 0) * 0.3048],
                                                         [previousSegment.lng, previousSegment.lat, 0]
                                                     ],
                                                     color: previousSegment.color || '#ff0000',
                                                     width: 3,
                                                     opacity: 1
                                                 });

                                                 if (localStorage.getItem('mapProjection') != 'globe') {
                                                     this.tb.add(line_vertical);
                                                 }
                                             }
                                           }
                                         }
                                     });

                                     return layerId;
                                 }

                                 function getNextWaypoints(waypoints, planeLat, planeLng, planeHeading) {
                                    let nearestIndex = 0;
                                    let minDistance = Infinity;

                                    // Find nearest waypoint
                                    waypoints.forEach((waypoint, i) => {
                                      const distance = Math.sqrt(
                                        Math.pow(waypoint.latitude - planeLat, 2) +
                                        Math.pow(waypoint.longitude - planeLng, 2)
                                      );
                                      if (distance < minDistance) {
                                        minDistance = distance;
                                        nearestIndex = i;
                                      }
                                    });

                                    // Check if nearest waypoint is behind the plane using heading
                                    const nearestWaypoint = waypoints[nearestIndex];
                                    const bearingToWaypoint = Math.atan2(
                                      nearestWaypoint.longitude - planeLng,
                                      nearestWaypoint.latitude - planeLat
                                    ) * 180 / Math.PI;

                                    // Normalize angles to 0-360
                                    const normalizedBearing = (bearingToWaypoint + 360) % 360;
                                    const normalizedHeading = (planeHeading + 360) % 360;

                                    // Calculate angle difference
                                    let angleDiff = Math.abs(normalizedBearing - normalizedHeading);
                                    if (angleDiff > 180) angleDiff = 360 - angleDiff;

                                    // If angle difference > 90°, waypoint is behind the plane
                                    const startIndex = angleDiff > 110 ? nearestIndex + 1 : nearestIndex;

                                    // Return waypoints from startIndex onwards
                                    return waypoints.slice(startIndex);
                                  }

                                 if (showFlightPlan == true){
                                   try{
                                     reduced = getNextWaypoints(waypoints, latlngs_dict[flightid]['lat'], latlngs_dict[flightid]['lng'], flight_dict[flightid]['text'][3])
                                     reducedformatted = reduced.slice(0, -1).map((point, i) => ({
                                        start: { lat: point.latitude, lng: point.longitude },
                                        end: { lat: reduced[i + 1].latitude, lng: reduced[i + 1].longitude },
                                        altitude: point.altitude,
                                        dashed: true,
                                        color: 'black',
                                        speed: 0
                                      }));
                                      reducedformatted[0]['start'] = {lat: latlngs_dict[flightid]['lat'], lng: latlngs_dict[flightid]['lng']}
                                      addLineSegments([...formatted, ...reducedformatted])
                                  } catch (err){
                                    addLineSegments(formatted)
                                  }
                                 } else {
                                   addLineSegments(formatted)
                                 }
                                 const layerId = createFlightPathLayer(map, flightpathlist);
                                 openNav()
                                 CURRENT_MARKER = [marker, planeIcon, flightid]
                                 if (marker.username != 'Santa Claus'){
                                   marker.getElement().children[0].style.backgroundImage = "url('./resources/"+planeIcon.replace('infinite', '').replace('special', '')+"clicked.png')"
                                 }
                                 document.getElementById('canvas').style.display='block'
                                 myLineChart = new Chart(document.getElementById('canvas'), {
                                      type: 'line',
                                      data: {
                                        datasets: [{
                                          label: 'Altitude (ft)',
                                          borderColor: 'rgb(255,215,0)',
                                          backgroundColor: 'rgba(255,215,0,0.1)',
                                          data: altitudeSeries.slice(0, -1),
                                          yAxisID: "y-axis-1",
                                          pointRadius: 0,
                                          lineTension: 0.15,
                                          fill: false
                                        },
                                        {
                                          label: 'Speed (kts)',
                                          borderColor: 'rgb(52,140,235)',
                                          backgroundColor: 'rgba(52,140,235,0.1)',
                                          data: speedSeries.slice(0, -1),
                                          yAxisID: "y-axis-2",
                                          pointRadius: 0,
                                          lineTension: 0.15,
                                          fill: false
                                        }]
                                      },
                                      options: {
                                        tooltips: {
                                          mode: 'index',
                                          intersect: false,
                                          callbacks: {
                                            title: function(items) {
                                              return formatTimestampLabel(items[0].xLabel);
                                            }
                                          }
                                        },
                                        hover: { intersect: false },
                                        onClick: function(evt, elements) {
                                          if (elements && elements.length) {
                                            const dataPoint = this.data.datasets[elements[0]._datasetIndex].data[elements[0]._index];
                                            if (dataPoint && dataPoint.originalIndex !== undefined) {
                                              startReplayAtIndex(dataPoint.originalIndex, flightid, graphPoints);
                                            }
                                          }
                                        },
                                        scales: {
                                                yAxes: [{
                                                    type: "linear",
                                                    display: true,
                                                    position: "left",
                                                    id: "y-axis-1",
                                                    gridLines: {
                                                      display: false
                                                    },
                                                    ticks: {
                                                      fontColor: '#e5e5e5'
                                                    },
                                                    scaleLabel: {
                                                      display: true,
                                                      labelString: 'Altitude (ft)'
                                                    }
                                                }, {
                                                    type: "linear",
                                                    display: true,
                                                    position: "right",
                                                    id: "y-axis-2",
                                                    gridLines: {
                                                      display: false
                                                    },
                                                    ticks: {
                                                      fontColor: '#e5e5e5'
                                                    },
                                                    scaleLabel: {
                                                      display: true,
                                                      labelString: 'Speed (kts)'
                                                    }
                                                }
                                                  ],
                                                xAxes: [{
                                                   type: 'time',
                                                   distribution: 'linear',
                                                   ticks: {
                                                    fontColor: '#e5e5e5'
                                                   },
                                                   time: {
                                                    tooltipFormat: 'HH:mm:ss',
                                                    displayFormats: {
                                                      second: 'HH:mm:ss',
                                                      minute: 'HH:mm',
                                                      hour: 'HH:mm'
                                                    }
                                                   },
                                                   gridLines: {
                                                  display: false
                                                }
                                              }]}
                                            }
                                          });
                                initializeReplayControls(flightid, graphPoints);
                                }
                              }
                            }
                          }
                          window.markerOnClick = markerOnClick
                        }
                        if (document.getElementById("mySidenav").style.display == 'block'){
                          if (CURRENT_MARKER && CURRENT_MARKER.length > 1 && (CURRENT_MARKER[1].includes('plane') || CURRENT_MARKER[1].includes('santa'))){
                            markerOnClick(CURRENT_MARKER[0])
                            displayPlaneDetails(CURRENT_MARKER[0])
                          }
                        }

                        markerBehaviour()

                        if (ifclick == 'yes' && TO_UPDATE == 'yes'){
                          if (TYPE == 'plane'){
                            fid = CURRENT_TRACK
                            plane = plane_markers[fid]
                            //map.flyTo([plane._lngLats[0]['lat'], plane._lngLats[0]['lng']], map.getZoom())
                            plane.getElement().click()
                            TO_UPDATE = 'no'
                            UPDATING = 'no'
                          }
                        }

                        if (po == true){
                          queryString = window.location.search;
                          urlParams = new URLSearchParams(queryString);
                          if (urlParams.has('flightid')){
                            fid = urlParams.get('flightid')
                            if (fid in plane_markers){
                              plane = plane_markers[fid]
                              map.flyTo([plane._lngLat['lat'], plane._lngLat['lng']], 10)
                              setTimeout(function(){plane.getElement().click()}, 2000)
                              iflick = 'yes'
                            } else{
                              alert('This flight has ended.')
                            }
                          }
                        }
                      }
                    latlngs_dict = copylatlngs_dict
                    }
                  }

              queryString = window.location.search;
              urlParams = new URLSearchParams(queryString);
              if (urlParams.has('f')){
                urlparam = urlParams.get('f')
                if (urlparam[0] == 'e'){
                  serverurl = 'ed323139-baa7-4834-b9d6-5fb9f19ff11e'
                  document.getElementById('serverdropdown').innerHTML = 'E' + document.getElementById('serverdropdown').innerHTML.slice(1)
                } else if (urlparam[0] == 't'){
                  serverurl = '15f884a5-52ec-467e-bda5-414d4569544d'
                  document.getElementById('serverdropdown').innerHTML = 'T' + document.getElementById('serverdropdown').innerHTML.slice(1)
                } else if (urlparam[0] == 'c'){
                  serverurl = "1f5ff830-8e4d-4477-89e7-21c136d54844"
                  document.getElementById('serverdropdown').innerHTML = 'C' + document.getElementById('serverdropdown').innerHTML.slice(1)
                } else {
                  serverurl = 'ed323139-baa7-4834-b9d6-5fb9f19ff11e'
                  document.getElementById('serverdropdown').innerHTML = 'E' + document.getElementById('serverdropdown').innerHTML.slice(1)
                }
              }
              // Add a delay before the first flight call to ensure icons are loaded
              setTimeout(() => {
                flight(serverurl, true);
                setTimeout(airport, 1000, serverurl);
                setTimeout(function(){showTrending('false'); if(urlParams.has('f')){redirectToMarker(urlparam.slice(1))}}, 2000);
              }, 1000);
              var maplat;
              var maplong;
              var refreshCounterForATC = 0
              setInterval(loadTracks, 3600000);
              loop = setInterval(refresh, 30000);       // divide by 1000 for seconds (change later)  30 secs
              function refresh(){
                refreshCounterForATC += 1
                flight(serverurl, false)
                if (refreshCounterForATC >= 3){
                  airport(serverurl)
                  refreshCounterForATC = 0
                }
              }

            if (localStorage.getItem('flightpathProjection') == '3D'){
              var flightpaths3D = true
              document.getElementById('flightpath-switch').checked = true
            } else {
              var flightpaths3D = false
            }
            document.getElementById('flightpath-switch').addEventListener('change', (event) => {
              if (event.target.checked) {
                 flightpaths3D = true
              } else {
                flightpaths3D = false
              }
              localStorage.setItem('flightpathProjection', event.target.checked ? '3D' : '2D');
            });

            if (localStorage.getItem('flightPlan') == 'yes'){
              var showFlightPlan = true
              document.getElementById('flightplan-switch').checked = true
            } else {
              var showFlightPlan = false
            }
            document.getElementById('flightplan-switch').addEventListener('change', (event) => {
              if (event.target.checked) {
                 showFlightPlan = true
              } else {
                showFlightPlan = false
              }
              localStorage.setItem('flightPlan', event.target.checked ? 'yes' : 'no');
            });

      </script>
    </div>
  </body>
</html>
