// Theme Toggle
const themeToggle = document.getElementById('themeToggle');
const themeIcon = themeToggle.querySelector('span');

// Check for saved theme preference or default to 'light'
const currentTheme = localStorage.getItem('theme') || 'light';
document.documentElement.setAttribute('data-theme', currentTheme);
updateThemeButton(currentTheme);

themeToggle.addEventListener('click', () => {
    const currentTheme = document.documentElement.getAttribute('data-theme');
    const newTheme = currentTheme === 'light' ? 'dark' : 'light';

    document.documentElement.setAttribute('data-theme', newTheme);
    localStorage.setItem('theme', newTheme);
    updateThemeButton(newTheme);
});

function updateThemeButton(theme) {
    if (theme === 'dark') {
        themeIcon.textContent = '☀️';
    } else {
        themeIcon.textContent = '🌙';
    }
}

// Scroll spy - Highlight active section in navigation
const sections = document.querySelectorAll('section[id]');
const navLinks = document.querySelectorAll('.quick-nav-link');

function highlightNavLink() {
    const scrollPosition = window.scrollY + 100; // Offset for better detection

    let currentSection = '';

    sections.forEach(section => {
        const sectionTop = section.offsetTop;
        const sectionHeight = section.offsetHeight;

        if (scrollPosition >= sectionTop && scrollPosition < sectionTop + sectionHeight) {
            currentSection = section.getAttribute('id');
        }
    });

    navLinks.forEach(link => {
        link.classList.remove('active');
        if (link.getAttribute('href') === `#${currentSection}`) {
            link.classList.add('active');
        }
    });
}

// Initial highlight
highlightNavLink();

// Update on scroll
window.addEventListener('scroll', highlightNavLink);

// Scroll animations
const observerOptions = {
    threshold: 0.1,
    rootMargin: '0px 0px -50px 0px'
};

const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
        if (entry.isIntersecting) {
            entry.target.classList.add('visible');
        }
    });
}, observerOptions);

document.querySelectorAll('.reveal').forEach(el => {
    observer.observe(el);
});

// Nav scroll effect
const nav = document.getElementById('nav');
window.addEventListener('scroll', () => {
    if (window.scrollY > 50) {
        nav.classList.add('scrolled');
    } else {
        nav.classList.remove('scrolled');
    }
});

// Smooth scroll for anchor links
document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function (e) {
        e.preventDefault();
        const target = document.querySelector(this.getAttribute('href'));
        if (target) {
            target.scrollIntoView({
                behavior: 'smooth',
                block: 'start'
            });
        }
    });
});

// Video play button toggle
document.querySelectorAll('.video-play-button').forEach(button => {
    const video = button.previousElementSibling;

    // Initial state - show button if video is paused
    if (!video.paused) {
        button.classList.add('hidden');
    }

    // Click handler
    button.addEventListener('click', function(e) {
        e.preventDefault();
        e.stopPropagation();
        if (video.paused) {
            video.play();
        } else {
            video.pause();
        }
    });

    // Hide button when video plays
    video.addEventListener('play', () => {
        button.classList.add('hidden');
    });

    // Show button when video pauses
    video.addEventListener('pause', () => {
        button.classList.remove('hidden');
    });

    // Show button when video ends
    video.addEventListener('ended', () => {
        button.classList.remove('hidden');
    });
});
