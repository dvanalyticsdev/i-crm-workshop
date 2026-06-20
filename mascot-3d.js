(function () {
  const container = document.getElementById("mascot3dContainer");
  if (!container) return;

  // Initialize Three.js Components
  const scene = new THREE.Scene();

  // Perspective Camera
  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
  camera.position.z = 3.4;

  // WebGL Renderer with alpha channel enabled for transparent backgrounds
  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(container.clientWidth || 160, container.clientHeight || 160);
  container.appendChild(renderer.domElement);

  // Main Robot group to hold all assemblies together
  const robotGroup = new THREE.Group();
  scene.add(robotGroup);

  // Head group inside robotGroup (rotates independently for cursor tracking)
  const headGroup = new THREE.Group();
  headGroup.position.set(0, 0.3, 0); // elevated head center
  robotGroup.add(headGroup);

  // --- Geometries & Materials ---
  // White Glossy Plastic/Ceramic for head, body, and arms
  const chassisMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.15,
    metalness: 0.1
  });

  // Dark Visor Plate Material (Glossy royal blue/black face screen)
  const visorMaterial = new THREE.MeshStandardMaterial({
    color: 0x0f172a, // Slate-900 (very dark)
    roughness: 0.6,
    metalness: 0.1
  });

  // Glowing Neon Cyan/Teal material for eyes and digital mouth
  const glowMaterial = new THREE.MeshBasicMaterial({ color: 0x06b6d4 });

  // Metallic Slate/Steel for ears, neck, and antenna details
  const metalMaterial = new THREE.MeshStandardMaterial({
    color: 0x64748b, // slate-500
    roughness: 0.2,
    metalness: 0.8
  });

  // Blush Cheeks Material
  const cheekMaterial = new THREE.MeshStandardMaterial({
    color: 0xf43f5e, // Rosy pink
    roughness: 0.2,
    metalness: 0.1
  });

  // --- Build the Mini-Boxy Bot ---
  // 1. Boxy Head
  const headGeo = new THREE.BoxGeometry(0.85, 0.62, 0.62);
  const headMesh = new THREE.Mesh(headGeo, chassisMaterial);
  headGroup.add(headMesh);

  // 2. Visor Screen on front of head
  const visorGeo = new THREE.BoxGeometry(0.72, 0.42, 0.04);
  const visorMesh = new THREE.Mesh(visorGeo, visorMaterial);
  visorMesh.position.set(0, 0, 0.3);
  headGroup.add(visorMesh);

  // 3. Bolts / Ears on the sides
  const earGeo = new THREE.CylinderGeometry(0.08, 0.08, 0.08, 16);
  
  const earLeft = new THREE.Mesh(earGeo, metalMaterial);
  earLeft.position.set(-0.45, 0, 0);
  earLeft.rotation.z = Math.PI / 2;
  headGroup.add(earLeft);

  const earRight = new THREE.Mesh(earGeo, metalMaterial);
  earRight.position.set(0.45, 0, 0);
  earRight.rotation.z = Math.PI / 2;
  headGroup.add(earRight);

  // 4. Antenna stem and bulb on top of head
  const antennaStemGeo = new THREE.CylinderGeometry(0.015, 0.015, 0.2, 8);
  const antennaStem = new THREE.Mesh(antennaStemGeo, metalMaterial);
  antennaStem.position.set(0, 0.4, 0);
  headGroup.add(antennaStem);

  const bulbGeo = new THREE.SphereGeometry(0.07, 16, 16);
  const bulb = new THREE.Mesh(bulbGeo, new THREE.MeshBasicMaterial({ color: 0xea580c }));
  bulb.position.set(0, 0.52, 0);
  headGroup.add(bulb);

  // 5. Blush Cheeks (Flat pink spheres on the bottom corners of the visor)
  const cheekGeo = new THREE.SphereGeometry(0.06, 16, 16);
  
  const cheekLeft = new THREE.Mesh(cheekGeo, cheekMaterial);
  cheekLeft.scale.set(1.0, 0.6, 0.25);
  cheekLeft.position.set(-0.25, -0.1, 0.325);
  headGroup.add(cheekLeft);

  const cheekRight = new THREE.Mesh(cheekGeo, cheekMaterial);
  cheekRight.scale.set(1.0, 0.6, 0.25);
  cheekRight.position.set(0.25, -0.1, 0.325);
  headGroup.add(cheekRight);

  // 6. Body Box (placed lower)
  const bodyGeo = new THREE.BoxGeometry(0.68, 0.52, 0.48);
  const bodyMesh = new THREE.Mesh(bodyGeo, chassisMaterial);
  bodyMesh.position.set(0, -0.38, 0);
  robotGroup.add(bodyMesh);

  // 7. Neck Cylinder Joint
  const neckGeo = new THREE.CylinderGeometry(0.1, 0.1, 0.12, 16);
  const neckMesh = new THREE.Mesh(neckGeo, metalMaterial);
  neckMesh.position.set(0, -0.06, 0);
  robotGroup.add(neckMesh);

  // 8. Cylinder Arms
  const armGeo = new THREE.CylinderGeometry(0.06, 0.06, 0.38, 16);
  
  const armLeft = new THREE.Mesh(armGeo, chassisMaterial);
  armLeft.position.set(-0.42, -0.34, 0);
  armLeft.rotation.z = 0.2; // default angle down
  robotGroup.add(armLeft);

  const armRight = new THREE.Mesh(armGeo, chassisMaterial);
  armRight.position.set(0.42, -0.34, 0);
  armRight.rotation.z = -0.2;
  robotGroup.add(armRight);

  // --- Glowing Eyes on Gelly's body face ---
  const leftEyes = {};
  const rightEyes = {};

  // Happy eye geometry (smiling arches ^ ^)
  const happyEyeGeo = new THREE.TorusGeometry(0.07, 0.02, 8, 24, Math.PI);
  
  const eyeHappyLeft = new THREE.Mesh(happyEyeGeo, glowMaterial);
  eyeHappyLeft.position.set(-0.16, 0.06, 0.325);
  eyeHappyLeft.rotation.set(0, 0, 0);
  headGroup.add(eyeHappyLeft);
  leftEyes['happy'] = eyeHappyLeft;

  const eyeHappyRight = new THREE.Mesh(happyEyeGeo, glowMaterial);
  eyeHappyRight.position.set(0.16, 0.06, 0.325);
  eyeHappyRight.rotation.set(0, 0, 0);
  headGroup.add(eyeHappyRight);
  rightEyes['happy'] = eyeHappyRight;

  // Sad eye geometry (down-turned worried arches v v)
  const sadEyeGeo = new THREE.TorusGeometry(0.07, 0.02, 8, 24, Math.PI);
  
  const eyeSadLeft = new THREE.Mesh(sadEyeGeo, glowMaterial);
  eyeSadLeft.position.set(-0.16, 0.1, 0.325);
  eyeSadLeft.rotation.set(0, 0, Math.PI);
  headGroup.add(eyeSadLeft);
  leftEyes['sad'] = eyeSadLeft;

  const eyeSadRight = new THREE.Mesh(sadEyeGeo, glowMaterial);
  eyeSadRight.position.set(0.16, 0.1, 0.325);
  eyeSadRight.rotation.set(0, 0, Math.PI);
  headGroup.add(eyeSadRight);
  rightEyes['sad'] = eyeSadRight;

  // Neutral eye geometry (glowing rounded ovals)
  const neutralEyeGeo = new THREE.SphereGeometry(0.07, 16, 16);
  
  const eyeNeutralLeft = new THREE.Mesh(neutralEyeGeo, glowMaterial);
  eyeNeutralLeft.position.set(-0.16, 0.06, 0.325);
  eyeNeutralLeft.scale.set(1.1, 0.85, 0.4);
  headGroup.add(eyeNeutralLeft);
  leftEyes['neutral'] = eyeNeutralLeft;

  const eyeNeutralRight = new THREE.Mesh(neutralEyeGeo, glowMaterial);
  eyeNeutralRight.position.set(0.16, 0.06, 0.325);
  eyeNeutralRight.scale.set(1.1, 0.85, 0.4);
  headGroup.add(eyeNeutralRight);
  rightEyes['neutral'] = eyeNeutralRight;

  // Surprised eye geometry (large circles)
  const surprisedEyeGeo = new THREE.SphereGeometry(0.07, 16, 16);
  
  const eyeSurprisedLeft = new THREE.Mesh(surprisedEyeGeo, glowMaterial);
  eyeSurprisedLeft.position.set(-0.16, 0.06, 0.325);
  eyeSurprisedLeft.scale.set(1.1, 1.1, 0.4);
  headGroup.add(eyeSurprisedLeft);
  leftEyes['surprised'] = eyeSurprisedLeft;

  const eyeSurprisedRight = new THREE.Mesh(surprisedEyeGeo, glowMaterial);
  eyeSurprisedRight.position.set(0.16, 0.06, 0.325);
  eyeSurprisedRight.scale.set(1.1, 1.1, 0.4);
  headGroup.add(eyeSurprisedRight);
  rightEyes['surprised'] = eyeSurprisedRight;

  // --- Dynamic Digital Mouth meshes ---
  const digitalMouths = {};
  const mouthGroup = new THREE.Group();
  headGroup.add(mouthGroup);

  // Happy digital mouth (little smile curve)
  const dmHappyGeo = new THREE.TorusGeometry(0.04, 0.01, 8, 16, Math.PI);
  const dmHappy = new THREE.Mesh(dmHappyGeo, glowMaterial);
  dmHappy.position.set(0, -0.08, 0.325);
  dmHappy.rotation.set(0, 0, Math.PI); // smiling curve
  mouthGroup.add(dmHappy);
  digitalMouths['happy'] = dmHappy;

  // Surprised digital mouth (little O circle)
  const dmSurprisedGeo = new THREE.TorusGeometry(0.02, 0.01, 8, 16);
  const dmSurprised = new THREE.Mesh(dmSurprisedGeo, glowMaterial);
  dmSurprised.position.set(0, -0.09, 0.325);
  mouthGroup.add(dmSurprised);
  digitalMouths['surprised'] = dmSurprised;

  // Neutral/Speaking mouth (flat line - flaps and visualizes talking waves)
  const dmNeutralGeo = new THREE.CylinderGeometry(0.008, 0.008, 0.08, 8);
  const dmNeutral = new THREE.Mesh(dmNeutralGeo, glowMaterial);
  dmNeutral.position.set(0, -0.09, 0.325);
  dmNeutral.rotation.set(0, 0, Math.PI / 2);
  mouthGroup.add(dmNeutral);
  digitalMouths['neutral'] = dmNeutral;

  let currentExpression = 'neutral';

  function setExpression(name) {
    currentExpression = name;
    
    // Toggle active eyes
    Object.keys(leftEyes).forEach(key => {
      leftEyes[key].visible = (key === name);
      rightEyes[key].visible = (key === name);
    });

    // Toggle active mouths (neutral is hidden by default)
    Object.keys(digitalMouths).forEach(key => {
      if (key === 'neutral') {
        digitalMouths[key].visible = false;
      } else {
        digitalMouths[key].visible = (key === name);
      }
    });

    // Adapt eye colors
    if (name === 'happy') {
      glowMaterial.color.setHex(0x38bdf8); // Sky blue
    } else if (name === 'sad') {
      glowMaterial.color.setHex(0x6366f1); // Indigo
    } else {
      glowMaterial.color.setHex(0x06b6d4); // Cyan
    }
  }

  // Initialize
  setExpression('neutral');

  // --- Lighting Setup ---
  // Soft ambient light
  const ambientLight = new THREE.AmbientLight(0xe2e8f0, 0.95);
  scene.add(ambientLight);

  // Main directional light for high-contrast glossy specular highlights on plastic
  const dirLight = new THREE.DirectionalLight(0xffffff, 1.5);
  dirLight.position.set(4, 5, 4);
  scene.add(dirLight);

  // Subtle cyan point light for custom eye-glow reflections
  const eyeLight = new THREE.PointLight(0x06b6d4, 0.7, 3);
  eyeLight.position.set(0, 0.2, 1);
  scene.add(eyeLight);

  // --- Cursor Tracking & Animation Loop ---
  let mouseX = 0;
  let mouseY = 0;
  let targetRotationX = 0;
  let targetRotationY = 0;
  let blinkTimer = 0;
  let pulseTimer = 0;
  let happyTimer = 0;
  let isTalking = false;

  // Track mouse coordinates normalized from -1 to 1
  document.addEventListener("mousemove", (event) => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    mouseX = (event.clientX / w) * 2 - 1;
    mouseY = -(event.clientY / h) * 2 + 1;
    
    // Target rotation based on mouse offset
    targetRotationX = mouseX * 0.35;
    targetRotationY = mouseY * 0.25;
  });

  // --- Speech Bubble & Click UI interactions ---
  const mascotAvatar = document.getElementById("mascotAvatar");
  const mascotJumper = document.getElementById("mascotJumper");
  const speechBubble = document.getElementById("mascotSpeechBubble");
  const speechText = document.getElementById("mascotSpeechText");
  const speechCloseBtn = document.getElementById("mascotSpeechCloseBtn");

  const bubbleMessages = [
    { text: "Need help? Tap the Match Game! 🎮", expression: "surprised" },
    { text: "I can find your perfect course! 🤖", expression: "happy" },
    { text: "Choose your skills, unlock careers! 🚀", expression: "happy" },
    { text: "Let's build your dream tech stack! 🛠️", expression: "happy" },
    { text: "Python or Power BI? Toggle them! 🐍", expression: "neutral" },
    { text: "Glow with generative AI! ⚡", expression: "surprised" }
  ];

  const clickMessages = [
    "Hello! Let's build something awesome! 🚀",
    "Beep-bloop! System online! 🤖",
    "Ready to learn? Tap the Game card! 🎮",
    "Bleep-bloop! Matching skills! ⚡",
    "Waving hello! Let's find your path! 🔋"
  ];

  let bubbleTimeout = null;
  let talkInterval = null;
  let lastSpeechOpenedAt = 0;

  function hideSpeech(immediate = false) {
    if (!speechBubble) return;
    if (bubbleTimeout) clearTimeout(bubbleTimeout);
    if (talkInterval) clearInterval(talkInterval);
    bubbleTimeout = null;
    talkInterval = null;
    isTalking = false;
    speechBubble.classList.remove("visible");

    const finalizeHide = () => {
      if (!speechBubble.classList.contains("visible")) {
        speechBubble.classList.add("hidden");
        if (currentExpression !== 'happy' || happyTimer === 0) {
          setExpression('neutral');
        }
      }
    };

    if (immediate) {
      finalizeHide();
      return;
    }

    setTimeout(finalizeHide, 300);
  }

  function showSpeech(text, expr = 'neutral') {
    if (!speechBubble || !speechText) return;
    
    setExpression(expr);
    if (bubbleTimeout) clearTimeout(bubbleTimeout);
    if (talkInterval) clearInterval(talkInterval);

    speechText.textContent = text;
    lastSpeechOpenedAt = Date.now();
    speechBubble.classList.remove("hidden");
    
    requestAnimationFrame(() => {
      speechBubble.classList.add("visible");
    });

    bubbleTimeout = setTimeout(() => {
      hideSpeech();
    }, 5000);
  }

  // Expose methods globally for integration
  window.mascotShowSpeech = (text, expr = 'neutral') => {
    isTalking = (expr === 'neutral');
    showSpeech(text, expr);
  };
  window.mascotSetExpression = setExpression;
  window.mascotReactToGameEvent = (eventName, detail = {}) => {
    switch (eventName) {
      case "game-opened":
        window.mascotShowSpeech("Mission online. Pick a few skills and I will help narrow the right program.", "happy");
        break;
      case "game-closed":
        window.mascotShowSpeech("No rush. Browse around and reopen the game whenever you want a guided match.", "neutral");
        break;
      case "best-match":
        window.mascotShowSpeech(`${detail.courseName || "That program"} looks like your strongest fit so far.`, "happy");
        break;
      case "course-hover":
        window.mascotShowSpeech(detail.message || `${detail.courseName || "This course"} looks worth exploring.`, detail.matchPct > 0 ? "happy" : "neutral");
        break;
      case "course-details":
        window.mascotShowSpeech(`${detail.courseName || "This program"} is open. Ask me to explain the match if you want the quick version.`, "neutral");
        break;
      case "archetype-unlocked":
        window.mascotShowSpeech(`Archetype unlocked: ${detail.label || "New path"}. Nice combination.`, "surprised");
        break;
      case "skills-reset":
        window.mascotShowSpeech("Reset complete. We can build a fresh path from scratch.", "surprised");
        break;
      case "surprise-path":
        window.mascotShowSpeech(`Surprise path loaded: ${detail.label || "new archetype"}. See how this one feels.`, "happy");
        break;
      case "register-opened":
        window.mascotShowSpeech(`Nice choice. ${detail.courseName || "This program"} is ready for registration.`, "happy");
        break;
      default:
        if (happyTimer === 0) {
          const randomMsg = bubbleMessages[Math.floor(Math.random() * bubbleMessages.length)];
          window.mascotShowSpeech(randomMsg.text, randomMsg.expression);
        }
        break;
    }
  };

  // Initial greeting 2.8s after landing
  setTimeout(() => {
    window.mascotShowSpeech("Welcome! Let's find your course! 🤖", "happy");
  }, 2800);

  if (mascotAvatar && mascotJumper) {
    mascotAvatar.addEventListener("click", () => {
      // Trigger CSS vertical spin hop
      mascotJumper.classList.remove("mascot-hop");
      void mascotJumper.offsetWidth;
      mascotJumper.classList.add("mascot-hop");

      // Happy state active for 90 frames (~1.5s)
      happyTimer = 90;
      setExpression('happy');

      // Show happy bubble text
      const clickMsg = clickMessages[Math.floor(Math.random() * clickMessages.length)];
      window.mascotShowSpeech(clickMsg, 'happy');
    });

    mascotJumper.addEventListener("animationend", (e) => {
      if (e.animationName === "mascot-spin-hop") {
        mascotJumper.classList.remove("mascot-hop");
      }
    });
  }

  if (speechCloseBtn) {
    speechCloseBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      hideSpeech(true);
    });
  }

  document.addEventListener("click", (event) => {
    if (!speechBubble || speechBubble.classList.contains("hidden")) return;
    if (Date.now() - lastSpeechOpenedAt < 250) return;
    const clickedInsideBubble = speechBubble.contains(event.target);
    const clickedMascot = mascotJumper && mascotJumper.contains(event.target);
    if (!clickedInsideBubble && !clickedMascot) {
      hideSpeech(true);
    }
  });

  const clock = new THREE.Clock();

  function animate() {
    requestAnimationFrame(animate);

    const time = clock.getElapsedTime();

    // 1. Robot Bobbing (Sine wave floating animation)
    robotGroup.position.y = Math.sin(time * 2.5) * 0.07;

    // 2. Body Breathing (subtle height scaling)
    bodyMesh.scale.y = 1.0 + Math.sin(time * 2.5) * 0.018;

    // 3. Head Tilt (curious organic rotation on Z axis)
    headGroup.rotation.z = Math.sin(time * 1.2) * 0.025;

    // 4. Arm waving animation
    if (happyTimer > 0) {
      // Waving arm animation
      armLeft.rotation.z = 1.0 + Math.sin(time * 18) * 0.45;
      armRight.rotation.z = -1.0 - Math.sin(time * 18) * 0.45;
    } else {
      // Calm breathing position
      armLeft.rotation.z = 0.2 + Math.sin(time * 1.5) * 0.02;
      armRight.rotation.z = -0.2 - Math.sin(time * 1.5) * 0.02;
    }

    // 5. Cursor Tracking with slight organic body-follow rotation
    if (happyTimer > 0) {
      headGroup.rotation.y += 0.12;
      happyTimer--;
      if (happyTimer === 0) {
        setExpression('neutral');
      }
    } else {
      headGroup.rotation.y = THREE.MathUtils.lerp(headGroup.rotation.y, targetRotationX, 0.07);
      headGroup.rotation.x = THREE.MathUtils.lerp(headGroup.rotation.x, -targetRotationY, 0.07);
      
      // Tilt the entire robot group slightly for cursor tracking reactivity
      robotGroup.rotation.y = THREE.MathUtils.lerp(robotGroup.rotation.y, targetRotationX * 0.12, 0.05);
      robotGroup.rotation.x = THREE.MathUtils.lerp(robotGroup.rotation.x, -targetRotationY * 0.08, 0.05);
    }

    // 6. Antenna bulb scale pulse winking
    bulb.scale.setScalar(1 + Math.sin(pulseTimer * 4) * 0.15);
    pulseTimer += 0.05;

    // 7. Talking Voice-Wave Oscillator
    if (isTalking && currentExpression === 'neutral') {
      digitalMouths['neutral'].visible = true;
      digitalMouths['neutral'].scale.y = 1.0 + Math.abs(Math.sin(time * 30)) * 2.2;
    } else {
      digitalMouths['neutral'].scale.y = 1.0;
      if (currentExpression === 'neutral') {
        digitalMouths['neutral'].visible = false;
      }
    }

    // 8. Randomized Eye Blinking on active eye mesh
    if (blinkTimer === 0 && Math.random() < 0.008) {
      blinkTimer = 10;
    }

    const activeEyeL = leftEyes[currentExpression];
    const activeEyeR = rightEyes[currentExpression];

    if (blinkTimer > 0 && activeEyeL && activeEyeR) {
      activeEyeL.scale.y = THREE.MathUtils.lerp(activeEyeL.scale.y, 0.05, 0.4);
      activeEyeR.scale.y = THREE.MathUtils.lerp(activeEyeR.scale.y, 0.05, 0.4);
      blinkTimer--;
    } else if (activeEyeL && activeEyeR) {
      let targetY = 1.0;
      if (currentExpression === 'surprised') targetY = 1.3;
      else if (currentExpression === 'neutral') targetY = 0.9;

      activeEyeL.scale.y = THREE.MathUtils.lerp(activeEyeL.scale.y, targetY, 0.3);
      activeEyeR.scale.y = THREE.MathUtils.lerp(activeEyeR.scale.y, targetY, 0.3);
    }

    renderer.render(scene, camera);
  }

  // --- Resize Observer ---
  const resizeObserver = new ResizeObserver(() => {
    const width = container.clientWidth || 160;
    const height = container.clientHeight || 160;
    renderer.setSize(width, height);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  });
  resizeObserver.observe(container);

  // Start the animation loop
  animate();
})();
