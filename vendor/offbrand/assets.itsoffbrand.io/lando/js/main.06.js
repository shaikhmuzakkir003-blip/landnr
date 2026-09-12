class initLargeLetters {
  constructor() {
    this.wrap = document.querySelector(".holding-bg-inner");
    this.letterRels = this.wrap?.querySelectorAll(".large-letters-group");

    // Store selectors as variables
    this.rowSelector = ".large-letters-row";
    this.letterSelector = ".large-letters-letter";

    // Animation configuration
    this.x = "5rem";
    this.y1 = "103%";
    this.y2 = "200%";
    this.y3 = "300%";
    this.rotate = 0;
    this.stagger = 0.05;
    this.duration = 1.5;
    this.delay = 1000;

    this.init();
  }

  init() {
    if (!this.wrap || !this.letterRels) return;

    this.setInitialStates();
    setTimeout(() => {
      this.animate();
    }, this.delay);
  }

  setInitialStates() {
    this.letterRels.forEach((rel, index) => {
      const rows = rel.querySelectorAll(this.rowSelector);
      const isBottomRel = index === 1;

      rows.forEach((row, rowIndex) => {
        gsap.set(row.querySelectorAll(this.letterSelector), {
          x: isBottomRel
            ? rowIndex === 0
              ? this.x
              : `-${this.x}`
            : rowIndex === 0
            ? this.x
            : `-${this.x}`,
          y: isBottomRel
            ? rowIndex === 0
              ? `-${this.y1}`
              : rowIndex === 1
              ? `-${this.y2}`
              : `-${this.y3}`
            : rowIndex === 0
            ? this.y1
            : rowIndex === 1
            ? this.y2
            : this.y3,
          rotate: isBottomRel ? -this.rotate : this.rotate,
        });
      });
    });
  }

  animate() {
    this.letterRels.forEach((rel, index) => {
      const rows = rel.querySelectorAll(this.rowSelector);
      const tl = gsap.timeline();
      const isBottomRel = index === 1;

      const gap = parseFloat(this.y2) - parseFloat(this.y1);

      // Row 0 animation (to final position)
      tl.to(
        rows[0].querySelectorAll(this.letterSelector),
        {
          x: isBottomRel ? `-${this.x}` : this.x,
          y: isBottomRel
            ? `${parseFloat(this.y1) + gap}%`
            : `-${parseFloat(this.y1) + gap}%`,
          rotate: isBottomRel ? this.rotate : -this.rotate,
          stagger: this.stagger,
          duration: this.duration,
          ease: "power2.inOut",
        },
        0
      );

      // Row 1 animation (follows row 0 out, maintaining gap)
      tl.to(
        rows[1].querySelectorAll(this.letterSelector),
        {
          x: isBottomRel ? `-${this.x}` : this.x,
          y: isBottomRel ? this.y1 : `-${this.y1}`,
          rotate: isBottomRel ? this.rotate : -this.rotate,
          stagger: this.stagger,
          duration: this.duration,
          ease: "power2.inOut",
        },
        0
      );

      // Row 2 animation (to center)
      tl.to(
        rows[2].querySelectorAll(this.letterSelector),
        {
          x: 0,
          y: 0,
          rotate: 0,
          stagger: this.stagger,
          duration: this.duration,
          ease: "power2.inOut",
        },
        0
      );
    });
  }
}

function initLargeLetterHover() {
  // Select all large letter final elements
  const finalElements = document.querySelectorAll("[large-letter-final]");

  // Store all timelines for control
  const timelines = [];

  // Configuration object for easy control
  const config = {
    duration: 0.6,
    stagger: 0.05,
    ease: "power2.inOut",
    colors: ["#d2ff00", "#111718"],
  };

  finalElements.forEach((finalElement, index) => {
    // Get all letter children
    const letters = finalElement.querySelectorAll(".large-letters-letter");

    // Track animation state
    let isAnimating = false;
    let shouldRestart = false;

    // Create timeline for this set of letters
    const tl = gsap.timeline({
      paused: true,
      onComplete: () => {
        isAnimating = false;
        if (shouldRestart) {
          shouldRestart = false;
          startAnimation();
        }
      },
    });

    // Get the opposite color for the return animation
    const returnColor = index === 0 ? config.colors[1] : config.colors[0];

    // Add color animation for each letter
    tl.to(letters, {
      color: config.colors[index],
      duration: config.duration,
      stagger: config.stagger,
      ease: config.ease,
    }).to(letters, {
      color: returnColor,
      duration: config.duration,
      stagger: config.stagger,
      ease: config.ease,
    });

    timelines.push(tl);

    // Function to start animation
    const startAnimation = () => {
      if (!isAnimating) {
        isAnimating = true;
        tl.restart();
        tl.play();
      } else {
        shouldRestart = true;
      }
    };

    // Add hover listeners
    finalElement.addEventListener("mouseenter", () => {
      startAnimation();
    });

    finalElement.addEventListener("mouseleave", () => {
      // Don't interrupt the animation, just mark that we've left
      shouldRestart = false;
    });
  });

  // Return control methods
  return {
    play: () => timelines.forEach((tl) => tl.play()),
    pause: () => timelines.forEach((tl) => tl.pause()),
    reverse: () => timelines.forEach((tl) => tl.reverse()),
    restart: () => timelines.forEach((tl) => tl.restart()),
    updateConfig: (newConfig) => {
      Object.assign(config, newConfig);
      timelines.forEach((tl) => {
        tl.duration(config.duration);
      });
    },
  };
}

function initSocialsIn() {
  const socials = document.querySelectorAll(".holding-social-svg");
  const defaultDuration = 0.8;

  gsap.to(socials, {
    delay: 2,
    y: 0,
    duration: defaultDuration,
    stagger: 0.05,
    ease: "power2.inOut",
  });
}

function initScaleIn() {
  const elements = document.querySelectorAll("[data-animate-scale]");
  const defaultDuration = 0.8;

  // Set initial state
  gsap.set(elements, {
    scale: 0,
    autoAlpha: 0,
    stagger: 0.4,
  });

  // Animate to final state
  gsap.to(elements, {
    scale: 1,
    autoAlpha: 1,
    duration: defaultDuration,
    stagger: 0.4,
    ease: "linear(0, 0.417 25.5%, 0.867 49.4%, 1 57.7%, 0.925 65.1%, 0.908 68.6%, 0.902 72.2%, 0.916 78.2%, 0.988 92.1%, 1)",
  });
}

function initCharSplit() {
  const offsetIncrement = 0.01;
  const elements = document.querySelectorAll("[split-chars]");

  elements.forEach((element) => {
    const text = element.textContent;
    element.innerHTML = "";

    [...text].forEach((char, index) => {
      const span = document.createElement("span");
      span.textContent = char;
      // span.style.transitionDelay = `${index * offsetIncrement}s`;

      if (char === " ") {
        span.style.whiteSpace = "pre";
      }

      element.appendChild(span);
    });
  });
}

function letterHoverElements() {
  const wraps = document.querySelectorAll("[data-animate-chars]");
  const defaultDuration = 0.8;

  wraps.forEach((wrap) => {
    const lines = wrap.querySelectorAll(".text-clip-line");

    lines.forEach((line, lineIndex) => {
      const chars = line.querySelectorAll("span");

      // Add hover event listeners
      wrap.addEventListener("mouseenter", () => {
        gsap.to(chars, {
          y: lineIndex === 0 ? "-100%" : "-100%",
          duration: defaultDuration,
          stagger: 0.02,
          ease: "power3.out",
          overwrite: true,
        });
      });

      wrap.addEventListener("mouseleave", () => {
        gsap.to(chars, {
          y: 0,
          duration: defaultDuration,
          stagger: 0.02,
          ease: "power3.out",
          overwrite: true,
        });
      });
    });
  });
}

// Modify otherLettersIn to trigger letterHoverElements on completion
function otherLettersIn() {
  const defaultDuration = 0.8;
  const wraps = document.querySelectorAll("[data-letter-load]");

  wraps.forEach((wrap) => {
    if (!wrap) return;

    const lines = wrap.querySelectorAll(".text-clip-line");

    lines.forEach((line, lineIndex) => {
      const chars = line.querySelectorAll("span");

      // Set initial state
      gsap.set(chars, {
        y: lineIndex === 0 ? "-200%" : "200%",
      });

      // Animate to final position
      gsap.to(chars, {
        delay: 2,
        y: 0,
        duration: defaultDuration,
        stagger: 0.02,
        ease: "power3.out",
        onComplete: () => {
          initLetterHoverBodyChange();
          if (window.innerWidth > 991) {
            letterHoverElements();
          }
          // console.log("hi");
        },
      });
    });
  });
}

// ********
// START -------------------------------------- mouse move animation
// ********

const config = {
  element: ".holding-hero-card", // Target element selector
  childElement: ".holding-hero-cs-message-w", // Child element selector
  maxXMove: 20, // Maximum X movement in rem
  maxYMove: 10, // Maximum Y movement in rem
  maxRotateX: 10, // Maximum rotation on X axis (degrees)
  maxRotateY: 10, // Maximum rotation on Y axis (degrees)
  maxZMove: 100, // Maximum Z movement in pixels for child
  smoothing: 0.1, // Smoothing factor (0-1), lower = smoother
  perspective: 1000, // Perspective value for 3D effect
  enabled: true, // Toggle animation on/off
};

// Utility function to convert rem to pixels
const remToPixels = (rem) => {
  return rem * parseFloat(getComputedStyle(document.documentElement).fontSize);
};

// State object to track current position
const state = {
  currentX: 0,
  currentY: 0,
  currentRotateX: 0,
  currentRotateY: 0,
  currentChildZ: 0,
  targetX: 0,
  targetY: 0,
  targetRotateX: 0,
  targetRotateY: 0,
  targetChildZ: 0,
};

// Initialize the animation
function initMouseAnimation(customConfig = {}) {
  // Merge custom config with defaults
  Object.assign(config, customConfig);

  const element = document.querySelector(config.element);
  const childElement = element?.querySelector(config.childElement);

  if (!element) {
    console.error(`Element ${config.element} not found`);
    return;
  }

  if (!childElement) {
    console.error(`Child element ${config.childElement} not found`);
    return;
  }

  // Set initial perspective on parent if it exists
  if (element.parentElement) {
    element.parentElement.style.perspective = `${config.perspective}px`;
  }

  // Mouse move handler
  const handleMouseMove = (e) => {
    if (!config.enabled) return;

    // Calculate mouse position relative to viewport center
    const mouseX = e.clientX;
    const mouseY = e.clientY;

    // Convert viewport coordinates to -1 to 1 range
    const normalizedX = (mouseX / window.innerWidth) * 2 - 1;
    const normalizedY = (mouseY / window.innerHeight) * 2 - 1;

    // Calculate distance from center (0-1 range)
    const distanceFromCenter = Math.min(
      1,
      Math.sqrt(normalizedX * normalizedX + normalizedY * normalizedY)
    );

    // Set target positions in pixels
    state.targetX = normalizedX * remToPixels(config.maxXMove);
    state.targetY = normalizedY * remToPixels(config.maxYMove);
    state.targetChildZ = distanceFromCenter * config.maxZMove;

    // Set target rotations - inverse Y rotation for natural tilt
    state.targetRotateY = normalizedX * config.maxRotateY;
    state.targetRotateX = -normalizedY * config.maxRotateX;
  };

  // Animation loop
  const animate = () => {
    if (config.enabled) {
      // Smooth transition to target position and rotation
      state.currentX += (state.targetX - state.currentX) * config.smoothing;
      state.currentY += (state.targetY - state.currentY) * config.smoothing;
      state.currentRotateX +=
        (state.targetRotateX - state.currentRotateX) * config.smoothing;
      state.currentRotateY +=
        (state.targetRotateY - state.currentRotateY) * config.smoothing;
      state.currentChildZ +=
        (state.targetChildZ - state.currentChildZ) * config.smoothing;

      // Apply transform with rotation to main element
      element.style.transform = `
              translate3d(${state.currentX}px, ${state.currentY}px, 0)
              rotateX(${state.currentRotateX}deg)
              rotateY(${state.currentRotateY}deg)
          `;

      // Apply z-transform to child element
      childElement.style.transform = `translateZ(${state.currentChildZ}px)`;
    }

    requestAnimationFrame(animate);
  };

  // Event listeners
  document.addEventListener("mousemove", handleMouseMove);
  animate();

  // Return control methods
  return {
    // Enable/disable animation
    toggle: (enabled) => {
      config.enabled = enabled;
      if (!enabled) {
        // Reset position when disabled
        state.currentX = 0;
        state.currentY = 0;
        state.currentRotateX = 0;
        state.currentRotateY = 0;
        state.currentChildZ = 0;
        state.targetX = 0;
        state.targetY = 0;
        state.targetRotateX = 0;
        state.targetRotateY = 0;
        state.targetChildZ = 0;
        element.style.transform = "translate3d(0, 0, 0)";
        childElement.style.transform = "translateZ(0)";
      }
    },
    // Update config
    updateConfig: (newConfig) => {
      Object.assign(config, newConfig);
    },
    // Get current config
    getConfig: () => ({ ...config }),
    // Clean up
    destroy: () => {
      config.enabled = false;
      document.removeEventListener("mousemove", handleMouseMove);
    },
  };
}

// ********
// END -------------------------------------- mouse move animation
// ********

function initWipeIn() {
  // Set initial state
  gsap.set('[data-wipe-in="1"]', { clipPath: "inset(0% 0% 100% 0%)" });
  gsap.set('[data-wipe-in="2"]', { clipPath: "inset(100% 0% 0% 0%)" });
  gsap.set('[data-wipe-in="3"]', { clipPath: "inset(0% 100% 0% 0%)" });
  gsap.set('[data-wipe-in="4"]', { clipPath: "inset(0% 100% 0% 0%)" });

  // Animate to final state
  gsap.to('[data-wipe-in="1"]', {
    clipPath: "inset(0% 0% 0% 0%)",
    delay: 1.5,
    duration: 1,
    ease: "power2.inOut",
  });

  gsap.to('[data-wipe-in="2"]', {
    clipPath: "inset(0% 0% 0% 0%)",
    delay: 1,
    duration: 1,
    ease: "power2.inOut",
  });

  gsap.to('[data-wipe-in="3"]', {
    clipPath: "inset(0% 0% 0% 0%)",
    delay: 2,
    duration: 1,
    ease: "power2.inOut",
  });

  gsap.to('[data-wipe-in="4"]', {
    clipPath: "inset(0% 0% 0% 0%)",
    delay: 1.5,
    duration: 1,
    ease: "power2.inOut",
  });
}

function initVideoHoverWipe() {
  const hoverTrigger1 = document.querySelector(".holding-letters-pos.norris");
  const targetVideo1 = document.querySelector("[ln-video='norris']");
  const hoverTrigger2 = document.querySelector(".holding-letters-pos.lando");
  const targetVideo2 = document.querySelector("[ln-video='lando']");

  if (hoverTrigger1 && targetVideo1) {
    hoverTrigger1.addEventListener("mouseenter", () => {
      targetVideo1.classList.add("video-visible");
    });

    hoverTrigger1.addEventListener("mouseleave", () => {
      targetVideo1.classList.remove("video-visible");
    });
  }

  if (hoverTrigger2 && targetVideo2) {
    hoverTrigger2.addEventListener("mouseenter", () => {
      targetVideo2.classList.add("video-visible");
    });

    hoverTrigger2.addEventListener("mouseleave", () => {
      targetVideo2.classList.remove("video-visible");
    });
  }
}

// function initLetterHoverBodyChange() {
//   // Select all elements with the specified data attributes
//   const blackElements = document.querySelectorAll('[data-gl-hover="#111718"]');
//   const limeElements = document.querySelectorAll('[data-gl-hover="#d2ff00"]');

//   // Function to handle hover events
//   const handleHover = (color) => {
//     document.body.style.color = color;
//   };

//   // Add event listeners for black elements
//   blackElements.forEach((element) => {
//     element.addEventListener("mouseenter", () =>
//       handleHover("var(--color--lime)")
//     );
//     element.addEventListener("mouseleave", () =>
//       handleHover("var(--color--black)")
//     );
//   });

//   // Add event listeners for lime elements
//   limeElements.forEach((element) => {
//     element.addEventListener("mouseenter", () =>
//       handleHover("var(--color--black)")
//     );
//     element.addEventListener("mouseleave", () =>
//       handleHover("var(--color--black)")
//     );
//   });
// }

function initLetterHoverBodyChange() {
  const blackElements = document.querySelectorAll('[data-gl-hover="#111718"]');
  const limeElements = document.querySelectorAll('[data-gl-hover="#d2ff00"]');
  const landoGroup = document.querySelector('.large-letters-group.lando');
  const norrisGroup = document.querySelector('.large-letters-group.norris');
 
  const handleHover = (color) => {
    document.body.style.color = color;
    landoGroup.style.color = color;
    norrisGroup.style.color = color;
  };
 
  const resetColors = () => {
    document.body.style.color = 'var(--color--black)';
    landoGroup.style.color = 'var(--color--black)';
    norrisGroup.style.color = 'var(--color--lime)';
  };
 
  blackElements.forEach((element) => {
    element.addEventListener("mouseenter", () => handleHover('var(--color--lime)'));
    element.addEventListener("mouseleave", resetColors);
  });
 
  limeElements.forEach((element) => {
    element.addEventListener("mouseenter", () => handleHover('var(--color--black)'));
    element.addEventListener("mouseleave", resetColors);
  });
 }

 function removeGlHoverAttributes() {
    // Find all elements with data-gl-hover attribute
    const elements = document.querySelectorAll('[data-gl-hover]');

    // Remove the attribute from each element
    elements.forEach(element => {
      element.removeAttribute('data-gl-hover');
    });
  }

 function initWelcomeMessage() {
    const baseStyle = "background-color: #d2ff00; color: black; font: 400 1em monospace; padding: 0.5em 0;";
    const boldStyle = "background-color: #d2ff00; color: black; font: 400 1em monospace; padding: 0.5em 0; font-weight: bold;";
    const plainStyle = "color: black; font: 400 1em monospace; padding: 0.5em 0;";

    // Log the styled message to the console
    console.log(
        "%c built by %cOFF+BRAND.%c %c > https://itsoffbrand.com ",
        baseStyle,
        boldStyle,
        baseStyle,
        plainStyle
);

 }



function slowFunction() {
  const initStart = document.querySelector('[data-start="hidden"]');

  // Show initial content
  gsap.to(initStart, {
    delay: 0.1,
    autoAlpha: 1,
    duration: 0.2,
  });

  if (window.innerWidth > 991) {
    // Desktop functions
    console.log("desktop");
    // Usage example:
    const mouseAnimation = initMouseAnimation({
      element: ".holding-hero-card",
      childElement: ".holding-hero-cs-message-w", // Child element selector
      maxZMove: 200, // Maximum Z movement in pixels for child
      maxXMove: 15, // rem
      maxYMove: 7.5,
      maxRotateX: 5, // deg
      maxRotateY: 5,
      smoothing: 0.1,
    });
  }

//   if (window.innerWidth <= 991) {
//   removeGlHoverAttributes();
// }

  initCharSplit();
  new initLargeLetters();
  letterHoverElements();
  // const letterAnimation = initLargeLetterHover();
  otherLettersIn();
  initSocialsIn();
  // initScaleIn();
  initWipeIn();
  initVideoHoverWipe();
  // initWelcomeMessage();
}

const onIdle = (fn) => {
  if ("scheduler" in window) {
    return scheduler.postTask(fn, {
      priority: "background",
    });
  }
  if ("requestIdleCallback" in window) {
    return requestIdleCallback(fn);
  }
  setTimeout(fn, 0);
};

onIdle(() => slowFunction());
