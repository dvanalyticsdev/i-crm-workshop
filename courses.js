import { PUBLIC_COURSES, findCourseById, formatAed, formatInr } from "./course-catalog.js";
import { bindThemeControls, initThemeSystem } from "./theme.js";
import { apiUrl } from "./api-client.js";

initThemeSystem();
bindThemeControls();

const coursesGrid = document.getElementById("coursesGrid");
const courseDetailsModal = document.getElementById("courseDetailsModal");
const registerModal = document.getElementById("registerModal");
const successModal = document.getElementById("successModal");
const registerForm = document.getElementById("registerForm");
const registerFormMessage = document.getElementById("registerFormMessage");
const submitRegistrationBtn = document.getElementById("submitRegistrationBtn");

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function getFakeRating(courseId) {
  let hash = 0;
  for (let i = 0; i < courseId.length; i++) {
    hash = courseId.charCodeAt(i) + ((hash << 5) - hash);
  }
  const rating = (4.6 + (Math.abs(hash) % 4) * 0.1).toFixed(1);
  const reviews = 85 + (Math.abs(hash) % 365);
  return { rating, reviews };
}

function renderStars(rating) {
  const fullStars = Math.floor(rating);
  const hasHalf = rating % 1 >= 0.5;
  let starsHtml = "";
  for (let i = 1; i <= 5; i++) {
    if (i <= fullStars) {
      starsHtml += '<span class="star filled">★</span>';
    } else if (i === fullStars + 1 && hasHalf) {
      starsHtml += '<span class="star half">★</span>';
    } else {
      starsHtml += '<span class="star">★</span>';
    }
  }
  return starsHtml;
}

const COURSE_SKILLS = {
  "apids": ["Python", "SQL Server", "PySpark & SAS", "Power BI", "Statistics", "Machine Learning", "Deep Learning", "Generative AI", "Agentic AI", "MLOps & LLMOps"],
  "apida": ["Python", "SQL Server", "PySpark & SAS", "Excel AI", "Power BI", "Tableau", "Statistics", "Machine Learning", "MLOps & LLMOps", "Reporting"],
  "advanced-aiml-genai-agentic": ["Python", "SQL Server", "Statistics", "Machine Learning", "Deep Learning", "Generative AI", "RAG Systems", "Agentic AI"],
  "master-genai-agentic": ["Python", "Deep Learning", "Generative AI", "RAG Systems", "Agentic AI", "Multi-Agent Systems", "Transformers", "Fine-Tuning"],
  "data-analytics-specialist": ["Python", "SQL Server", "Excel AI", "Power BI", "Tableau", "Reporting"],
  "apcs": ["Cybersecurity", "Ethical Hacking", "Digital Forensics", "Incident Response"]
};

const SKILL_CATEGORIES = [
  {
    name: "Data & BI Tools",
    skills: ["SQL Server", "Excel AI", "Power BI", "Tableau", "PySpark & SAS", "Reporting"]
  },
  {
    name: "Data Science & ML",
    skills: ["Python", "Statistics", "Machine Learning", "Deep Learning", "MLOps & LLMOps"]
  },
  {
    name: "Generative AI & Agents",
    skills: ["Generative AI", "RAG Systems", "Agentic AI", "Multi-Agent Systems", "Transformers", "Fine-Tuning"]
  },
  {
    name: "Cybersecurity",
    skills: ["Cybersecurity", "Ethical Hacking", "Digital Forensics", "Incident Response"]
  }
];

const selectedSkills = new Set();

// Contextual Skill Advisor database
function getSkillAdvice(skill, isSelected) {
  if (!isSelected) {
    return {
      text: `Removed ${skill}. Keep exploring other skills! 🔍`,
      expr: 'neutral'
    };
  }

  // Double skills combinations
  if (selectedSkills.has("Python") && selectedSkills.has("Deep Learning")) {
    return {
      text: "Awesome! You are building a powerful Neural Network stack! 🧠",
      expr: "happy"
    };
  }
  if (selectedSkills.has("SQL") && selectedSkills.has("Spark")) {
    return {
      text: "Perfect combination for Big Data & Analytics! 🏎️",
      expr: "happy"
    };
  }
  if (selectedSkills.has("Generative AI") && selectedSkills.has("Agentic AI")) {
    return {
      text: "You are ready to build fully autonomous multi-agent systems! 🚀",
      expr: "happy"
    };
  }
  if (selectedSkills.has("Cybersecurity") && selectedSkills.has("Ethical Hacking")) {
    return {
      text: "Ethical Hacking and cyber defense make you a security champion! 🛡️",
      expr: "happy"
    };
  }

  // Individual skill advice
  switch (skill) {
    case "Python":
      return {
        text: "Excellent! Python is the foundation of modern AI. Learn NumPy and Pandas! 🐍",
        expr: "happy"
      };
    case "Machine Learning":
      return {
        text: "Machine Learning models derive patterns from data. Try Deep Learning next! 🧠",
        expr: "happy"
      };
    case "Deep Learning":
      return {
        text: "Deep Learning powers computer vision and NLP. Learn Transformers next! ⚡",
        expr: "happy"
      };
    case "Statistics":
      return {
        text: "Statistics helps you understand data distributions and test hypotheses! 📊",
        expr: "neutral"
      };
    case "NumPy":
      return {
        text: "NumPy is the core library for numerical computation in Python! 🧮",
        expr: "neutral"
      };
    case "Pandas":
      return {
        text: "Pandas is the Swiss Army knife for data manipulation and analysis! 🐼",
        expr: "happy"
      };
    case "SQL":
      return {
        text: "SQL is key for extracting data! Have you looked at Data Pipelines? 💾",
        expr: "surprised"
      };
    case "Spark":
      return {
        text: "Apache Spark is the king of big data processing at scale! 🏎️",
        expr: "surprised"
      };
    case "Cloud Computing (AWS/Azure)":
      return {
        text: "Cloud platforms are vital! Deploy your pipelines in the cloud! ☁️",
        expr: "happy"
      };
    case "NoSQL":
      return {
        text: "NoSQL databases are perfect for unstructured and real-time big data! 🗄️",
        expr: "neutral"
      };
    case "Data Pipelines":
      return {
        text: "Data Pipelines automate ETL flows to feed clean data to models! ⚙️",
        expr: "happy"
      };
    case "Generative AI":
      return {
        text: "Generative AI is a superpower! Try RAG Systems or Agentic AI next! ⚡",
        expr: "surprised"
      };
    case "RAG Systems":
      return {
        text: "RAG hooks LLMs to databases to prevent hallucinations! 📚",
        expr: "happy"
      };
    case "Agentic AI":
      return {
        text: "Agentic AI allows models to reason, plan, and call tools autonomously! 🤖",
        expr: "happy"
      };
    case "Multi-Agent Systems":
      return {
        text: "Multi-Agent Systems allow multiple AI agents to collaborate on tasks! 🤝",
        expr: "happy"
      };
    case "Transformers":
      return {
        text: "Transformers power models like GPT and BERT. Core AI tech! ⚡",
        expr: "surprised"
      };
    case "Fine-Tuning":
      return {
        text: "Fine-Tuning adapts pre-trained LLMs to domain-specific knowledge! 🎯",
        expr: "happy"
      };
    case "Cybersecurity":
      return {
        text: "Cybersecurity is in huge demand! Learn Ethical Hacking next! 🛡️",
        expr: "surprised"
      };
    case "Ethical Hacking":
      return {
        text: "Ethical Hacking helps you find weaknesses before malicious actors! 💻",
        expr: "happy"
      };
    case "Digital Forensics":
      return {
        text: "Forensics makes you a digital detective solving cyber crimes! 🕵️‍♂️",
        expr: "surprised"
      };
    case "Incident Response":
      return {
        text: "Incident Response prepares you to stop active cyber breaches! 🚨",
        expr: "happy"
      };
    default:
      return {
        text: `Nice choice! Learning ${skill} opens up great opportunities! 🚀`,
        expr: "happy"
      };
  }
}

function renderSkillTree() {
  const container = document.getElementById("skillTreeCategories");
  if (!container) return;

  container.innerHTML = SKILL_CATEGORIES.map(category => {
    const skillsHtml = category.skills.map(skill => {
      const isSelected = selectedSkills.has(skill);
      return `
        <button type="button" class="skill-tag ${isSelected ? 'selected' : ''}" data-skill="${escapeHtml(skill)}">
          ${isSelected ? '✓ ' : ''}${escapeHtml(skill)}
        </button>
      `;
    }).join("");

    return `
      <div class="skill-category">
        <h3 class="skill-category-title">${escapeHtml(category.name)}</h3>
        <div class="skill-tags-list">
          ${skillsHtml}
        </div>
      </div>
    `;
  }).join("");

  const resetBtn = document.getElementById("resetSkillsBtn");
  if (resetBtn) {
    resetBtn.style.display = selectedSkills.size > 0 ? "inline-block" : "none";
  }

  container.querySelectorAll(".skill-tag").forEach(tag => {
    tag.addEventListener("click", () => {
      const skill = tag.getAttribute("data-skill");
      const isNowSelected = !selectedSkills.has(skill);
      if (selectedSkills.has(skill)) {
        selectedSkills.delete(skill);
      } else {
        selectedSkills.add(skill);
      }
      renderSkillTree();
      renderCourses();

      // Trigger contextual advice from mascot
      if (window.mascotShowSpeech) {
        const advice = getSkillAdvice(skill, isNowSelected);
        window.mascotShowSpeech(advice.text, advice.expr);
      }
    });
  });
}

function renderCourses() {
  let maxMatchPct = 0;
  const courseMatches = {};
  const hasMatch = selectedSkills.size > 0;

  if (hasMatch) {
    PUBLIC_COURSES.forEach(course => {
      const courseSkills = COURSE_SKILLS[course.id] || [];
      const matchingSkills = courseSkills.filter(s => selectedSkills.has(s)).length;
      const pct = Math.round((matchingSkills / selectedSkills.size) * 100);
      courseMatches[course.id] = pct;
      if (pct > maxMatchPct) {
        maxMatchPct = pct;
      }
    });
  }

  coursesGrid.innerHTML = PUBLIC_COURSES.map((course) => {
    const { rating, reviews } = getFakeRating(course.id);
    const matchPct = hasMatch ? (courseMatches[course.id] || 0) : 0;
    const isBestMatch = hasMatch && matchPct === maxMatchPct && maxMatchPct > 0;
    const matchBadgeHtml = hasMatch
      ? `<span class="course-card__match-badge">${matchPct}% Match</span>`
      : "";

    return `
      <article class="course-card ${isBestMatch ? 'course-card--best-match' : ''}" data-course-card="${course.id}" tabindex="0" role="button" aria-label="View ${escapeHtml(course.name)} details">
        ${matchBadgeHtml}
        <div class="course-card__poster-wrap">
          <img
            class="course-card__poster"
            src="${escapeHtml(course.poster || "")}"
            alt="${escapeHtml(course.name)} poster"
            loading="lazy"
          />
        </div>
        <div class="course-card__head">
          <span class="course-card__badge">${escapeHtml(course.badge)}</span>
          <span class="course-card__duration">${escapeHtml(course.duration)}</span>
        </div>
        <h2>${escapeHtml(course.name)}</h2>
        <p class="course-card__headline">${escapeHtml(course.headline)}</p>
        <div class="course-card__rating" title="${rating} out of 5 stars based on ${reviews} reviews">
          <div class="course-card__stars">
            ${renderStars(rating)}
          </div>
          <span class="course-card__rating-val">${rating}</span>
          <span class="course-card__reviews">(${reviews})</span>
        </div>
        <div class="course-card__actions">
          <button type="button" class="btn-ghost check-details-btn" data-check-details="${course.id}">Check Details</button>
          <button type="button" class="btn-primary register-course-btn" data-register-course="${course.id}">Register Now</button>
        </div>
      </article>
    `;
  }).join("");

  document.querySelectorAll("[data-course-card]").forEach((card) => {
    card.addEventListener("click", (event) => {
      if (event.target.closest(".register-course-btn") || event.target.closest(".check-details-btn")) {
        return;
      }
      openCourseDetails(card.getAttribute("data-course-card"));
    });
    card.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        openCourseDetails(card.getAttribute("data-course-card"));
      }
    });
  });

  document.querySelectorAll("[data-check-details]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      openCourseDetails(button.getAttribute("data-check-details"));
    });
  });

  document.querySelectorAll("[data-register-course]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      openRegisterModal(button.getAttribute("data-register-course"));
    });
  });
}

function renderCourseAccordion(course) {
  const accordionContainer = document.getElementById("courseModalAccordion");
  if (!accordionContainer) return;

  const sections = Array.isArray(course.sections) ? course.sections : [];
  const allSections = [
    ...sections,
    {
      title: "Program Fee",
      isFeeSection: true
    }
  ];

  accordionContainer.innerHTML = allSections.map((section, index) => {
    const isFirst = index === 0;
    
    let contentHtml = "";
    if (section.isFeeSection) {
      contentHtml = `
        <div class="modal-price-banner" style="margin: 0; background: var(--surface); border: 1px dashed var(--border-strong);">
          <div class="price-banner-item">
            <span class="price-banner-label">INR Price (incl. 18% GST)</span>
            <strong class="price-banner-val">${escapeHtml(formatInr(course.price.totalInr))}</strong>
          </div>
          <div class="price-banner-item">
            <span class="price-banner-label">AED Price</span>
            <strong class="price-banner-val">${escapeHtml(formatAed(course.price.totalAed))}</strong>
          </div>
        </div>
      `;
    } else {
      contentHtml = `
        ${(Array.isArray(section.paragraphs) ? section.paragraphs : [])
          .map((paragraph) => `<p class="accordion-paragraph">${escapeHtml(paragraph)}</p>`)
          .join("")}
        ${Array.isArray(section.bullets) && section.bullets.length ? `
          <ul class="accordion-list">
            ${section.bullets.map((bullet) => `<li>${escapeHtml(bullet)}</li>`).join("")}
          </ul>
        ` : ""}
      `;
    }

    return `
      <div class="accordion-item ${isFirst ? "accordion-item--active" : ""}">
        <button type="button" class="accordion-trigger" aria-expanded="${isFirst ? "true" : "false"}" data-accordion-index="${index}">
          <span class="accordion-title">${escapeHtml(section.title)}</span>
          <span class="accordion-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="6 9 12 15 18 9"></polyline>
            </svg>
          </span>
        </button>
        <div class="accordion-content" style="${isFirst ? "" : "display: none;"}">
          <div class="accordion-content-inner">
            ${contentHtml}
          </div>
        </div>
      </div>
    `;
  }).join("");

  accordionContainer.querySelectorAll("[data-accordion-index]").forEach((trigger) => {
    trigger.onclick = () => {
      const item = trigger.closest(".accordion-item");
      const content = item.querySelector(".accordion-content");
      const isExpanded = trigger.getAttribute("aria-expanded") === "true";

      // Collapse all other items
      accordionContainer.querySelectorAll(".accordion-item").forEach((otherItem) => {
        if (otherItem !== item) {
          otherItem.classList.remove("accordion-item--active");
          const otherTrigger = otherItem.querySelector(".accordion-trigger");
          otherTrigger.setAttribute("aria-expanded", "false");
          const otherContent = otherItem.querySelector(".accordion-content");
          otherContent.style.display = "none";
        }
      });

      // Toggle current item
      if (isExpanded) {
        item.classList.remove("accordion-item--active");
        trigger.setAttribute("aria-expanded", "false");
        content.style.display = "none";
      } else {
        item.classList.add("accordion-item--active");
        trigger.setAttribute("aria-expanded", "true");
        content.style.display = "block";
      }
    };
  });
}

const COURSE_HOOKS = {
  apids: {
    highlights: [
      "GenAI & Agentic AI focus with multi-agent system workflows",
      "Real-world projects across banking, healthcare, retail, & telecom",
      "Comprehensive MLOps & LLMOps deployment training for production"
    ],
    features: [
      {
        icon: `
          <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect>
            <line x1="8" y1="21" x2="16" y2="21"></line>
            <line x1="12" y1="17" x2="12" y2="21"></line>
          </svg>
        `,
        title: "240+ Learning Hours",
        subtext: "Instructor-Led Sessions"
      },
      {
        icon: `
          <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10"></circle>
            <polyline points="12 6 12 12 16 14"></polyline>
          </svg>
        `,
        title: "6-8 Months",
        subtext: "Program Duration"
      },
      {
        icon: `
          <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="2" y="7" width="20" height="14" rx="2" ry="2"></rect>
            <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"></path>
          </svg>
        `,
        title: "Placement Assistance*",
        subtext: "Dedicated Hiring Network"
      },
      {
        icon: `
          <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M22 10v6M2 10l10-5 10 5-10 5z"></path>
            <path d="M6 12v5c0 2 2 3 6 3s6-1 6-3v-5"></path>
          </svg>
        `,
        title: "Career Support",
        subtext: "For Freshers & Professionals"
      }
    ]
  },
  apida: {
    highlights: [
      "Focused on business intelligence, reporting, & executive dashboards",
      "Master SQL, Python, Excel AI, Power BI & Tableau",
      "Applied machine learning & decision-making statistics"
    ],
    features: [
      {
        icon: `
          <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect>
            <line x1="8" y1="21" x2="16" y2="21"></line>
            <line x1="12" y1="17" x2="12" y2="21"></line>
          </svg>
        `,
        title: "180+ Learning Hours",
        subtext: "Hands-on Lab Exercises"
      },
      {
        icon: `
          <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10"></circle>
            <polyline points="12 6 12 12 16 14"></polyline>
          </svg>
        `,
        title: "4-5 Months",
        subtext: "Flexible Scheduling"
      },
      {
        icon: `
          <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="2" y="7" width="20" height="14" rx="2" ry="2"></rect>
            <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"></path>
          </svg>
        `,
        title: "15+ Industry Cases",
        subtext: "Real Domain Data Analysis"
      },
      {
        icon: `
          <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M22 10v6M2 10l10-5 10 5-10 5z"></path>
            <path d="M6 12v5c0 2 2 3 6 3s6-1 6-3v-5"></path>
          </svg>
        `,
        title: "Placement Assistance",
        subtext: "Resume Prep & Mock Interviews"
      }
    ]
  },
  "advanced-aiml-genai-agentic": {
    highlights: [
      "Advanced neural networks, deep learning & transformer architectures",
      "Design multi-agent setups with LangGraph, CrewAI & AutoGen",
      "Deploy scalable systems using advanced MLOps & cloud scaling"
    ],
    features: [
      {
        icon: `
          <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect>
            <line x1="8" y1="21" x2="16" y2="21"></line>
            <line x1="12" y1="17" x2="12" y2="21"></line>
          </svg>
        `,
        title: "200+ Learning Hours",
        subtext: "Deep Technical Coding"
      },
      {
        icon: `
          <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10"></circle>
            <polyline points="12 6 12 12 16 14"></polyline>
          </svg>
        `,
        title: "5-6 Months",
        subtext: "Accelerated Learning Track"
      },
      {
        icon: `
          <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="2" y="7" width="20" height="14" rx="2" ry="2"></rect>
            <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"></path>
          </svg>
        `,
        title: "Hands-on GPU Labs",
        subtext: "Train Models on Cloud GPUs"
      },
      {
        icon: `
          <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="2" y="7" width="20" height="14" rx="2" ry="2"></rect>
            <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"></path>
          </svg>
        `,
        title: "Placement Assistance*",
        subtext: "Dedicated Hiring Network"
      }
    ]
  },
  "master-genai-agentic": {
    highlights: [
      "Deep dive into LLMs, prompt engineering, & prompt routing",
      "Build RAG systems, vector search, & custom indexing layers",
      "Construct production-grade autonomous agent networks"
    ],
    features: [
      {
        icon: `
          <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect>
            <line x1="8" y1="21" x2="16" y2="21"></line>
            <line x1="12" y1="17" x2="12" y2="21"></line>
          </svg>
        `,
        title: "120+ Learning Hours",
        subtext: "Focus on Builder Labs"
      },
      {
        icon: `
          <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10"></circle>
            <polyline points="12 6 12 12 16 14"></polyline>
          </svg>
        `,
        title: "3 Months",
        subtext: "Fast-Track Specialization"
      },
      {
        icon: `
          <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="2" y="7" width="20" height="14" rx="2" ry="2"></rect>
            <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"></path>
          </svg>
        `,
        title: "8+ GenAI Projects",
        subtext: "Ready-to-Deploy Portfolio Apps"
      },
      {
        icon: `
          <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M22 10v6M2 10l10-5 10 5-10 5z"></path>
            <path d="M6 12v5c0 2 2 3 6 3s6-1 6-3v-5"></path>
          </svg>
        `,
        title: "Global Certification",
        subtext: "Verify Your AI Expertise"
      }
    ]
  },
  "data-analytics-specialist": {
    highlights: [
      "Perfect career transition pathway for non-technical fields",
      "Learn SQL database structures, Excel macros & core statistics",
      "Interactive data storytelling with Power BI & Tableau dashboards"
    ],
    features: [
      {
        icon: `
          <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect>
            <line x1="8" y1="21" x2="16" y2="21"></line>
            <line x1="12" y1="17" x2="12" y2="21"></line>
          </svg>
        `,
        title: "100+ Learning Hours",
        subtext: "Beginner-Friendly Lectures"
      },
      {
        icon: `
          <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10"></circle>
            <polyline points="12 6 12 12 16 14"></polyline>
          </svg>
        `,
        title: "3 Months",
        subtext: "Rapid Career Pivot"
      },
      {
        icon: `
          <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="2" y="7" width="20" height="14" rx="2" ry="2"></rect>
            <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"></path>
          </svg>
        `,
        title: "10+ Reporting Projects",
        subtext: "Interactive BI Deployments"
      },
      {
        icon: `
          <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M22 10v6M2 10l10-5 10 5-10 5z"></path>
            <path d="M6 12v5c0 2 2 3 6 3s6-1 6-3v-5"></path>
          </svg>
        `,
        title: "Expert Mentorship",
        subtext: "Weekly 1-on-1 Guidance"
      }
    ]
  },
  apcs: {
    highlights: [
      "Master MLOps pipeline design: CI/CD, monitoring & drift checks",
      "Deploy models to AWS, GCP, and Azure using Docker & Kubernetes",
      "Automated testing, versioning & orchestration with GitHub & MLflow"
    ],
    features: [
      {
        icon: `
          <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect>
            <line x1="8" y1="21" x2="16" y2="21"></line>
            <line x1="12" y1="17" x2="12" y2="21"></line>
          </svg>
        `,
        title: "150+ Learning Hours",
        subtext: "Heavy Hands-on Exercises"
      },
      {
        icon: `
          <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10"></circle>
            <polyline points="12 6 12 12 16 14"></polyline>
          </svg>
        `,
        title: "4-6 Months",
        subtext: "Highly Technical Curriculum"
      },
      {
        icon: `
          <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="2" y="7" width="20" height="14" rx="2" ry="2"></rect>
            <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"></path>
          </svg>
        `,
        title: "Live Cloud Labs",
        subtext: "Real Cloud Infrastructure Credits"
      },
      {
        icon: `
          <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M22 10v6M2 10l10-5 10 5-10 5z"></path>
            <path d="M6 12v5c0 2 2 3 6 3s6-1 6-3v-5"></path>
          </svg>
        `,
        title: "Expert Mentorship",
        subtext: "Cybersecurity Career Coaching"
      }
    ]
  }
};

function openCourseDetails(courseId) {
  const course = findCourseById(courseId);
  if (!course) {
    return;
  }

  document.getElementById("courseModalBadge").textContent = course.badge;
  document.getElementById("courseModalTitle").textContent = course.name;
  
  // Retrieve hooks for this course
  const hooks = COURSE_HOOKS[course.id] || { highlights: [], features: [] };
  
  // Render bullets (highlights) with check SVGs
  const bulletsContainer = document.getElementById("courseModalHookBullets");
  bulletsContainer.innerHTML = (hooks.highlights || []).map((highlight) => `
    <li>
      <span class="hook-bullet-icon-wrap" aria-hidden="true">
        <svg class="hook-bullet-icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="20 6 9 17 4 12"></polyline>
        </svg>
      </span>
      <span class="hook-bullet-text">${escapeHtml(highlight)}</span>
    </li>
  `).join("");

  // Render Features Grid
  const featuresContainer = document.getElementById("courseModalFeaturesGrid");
  featuresContainer.innerHTML = (hooks.features || []).map((feat) => `
    <div class="modal-feature-item">
      <div class="modal-feature-icon-wrap" aria-hidden="true">
        ${feat.icon}
      </div>
      <div class="modal-feature-text">
        <h4 class="modal-feature-title">${escapeHtml(feat.title)}</h4>
        <span class="modal-feature-subtext">${escapeHtml(feat.subtext)}</span>
      </div>
    </div>
  `).join("");

  renderCourseAccordion(course);
  courseDetailsModal.classList.remove("hidden");
}

function closeCourseDetails() {
  courseDetailsModal.classList.add("hidden");
}

function openRegisterModal(courseId) {
  const course = findCourseById(courseId);
  if (!course) {
    return;
  }

  registerForm.reset();
  document.getElementById("registerCourseId").value = course.id;
  document.getElementById("registerModalTitle").textContent = "Register for the Program";
  document.getElementById("registerModalCourse").textContent = course.name;
  registerFormMessage.textContent = "";
  registerFormMessage.style.color = "var(--danger)";
  registerModal.classList.remove("hidden");
}

function closeRegisterModal() {
  registerModal.classList.add("hidden");
}

function openSuccessModal() {
  successModal.classList.remove("hidden");
}

function closeSuccessModal() {
  successModal.classList.add("hidden");
}

function setFormMessage(message, isError = true) {
  registerFormMessage.textContent = message;
  registerFormMessage.style.color = isError ? "var(--danger)" : "var(--success)";
}

async function submitRegistration(event) {
  event.preventDefault();

  const course = findCourseById(document.getElementById("registerCourseId").value);
  if (!course) {
    setFormMessage("Select a valid course before submitting.");
    return;
  }

  const payload = {
    courseId: course.id,
    name: document.getElementById("registerName").value.trim(),
    phone: document.getElementById("registerPhone").value.trim(),
    email: document.getElementById("registerEmail").value.trim()
  };

  if (!payload.name || !payload.phone || !payload.email) {
    setFormMessage("Name, phone number, and email address are required.");
    return;
  }

  submitRegistrationBtn.disabled = true;
  setFormMessage("");

  try {
    const response = await fetch(apiUrl("/api/public-course-registrations"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json"
      },
      body: JSON.stringify(payload)
    });
    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      setFormMessage(data?.message || "We could not save your registration. Please try again.");
      return;
    }

    if (data?.alreadyRegistered) {
      setFormMessage(data?.message || "You have already registered for this course.", false);
      return;
    }

        closeRegisterModal();
    openSuccessModal();
  } catch {
    setFormMessage("We could not save your registration. Please try again.");
  } finally {
    submitRegistrationBtn.disabled = false;
  }
}

const SUCCESS_STORIES = [
  "WhatsApp Image 2026-06-20 at 12.46.51 AM.jpeg",
  "WhatsApp Image 2026-06-20 at 12.46.52 AM (1).jpeg",
  "WhatsApp Image 2026-06-20 at 12.46.52 AM.jpeg",
  "WhatsApp Image 2026-06-20 at 12.46.53 AM (1).jpeg",
  "WhatsApp Image 2026-06-20 at 12.46.53 AM (2).jpeg",
  "WhatsApp Image 2026-06-20 at 12.46.53 AM.jpeg",
  "WhatsApp Image 2026-06-20 at 12.46.54 AM (1).jpeg",
  "WhatsApp Image 2026-06-20 at 12.46.54 AM.jpeg",
  "WhatsApp Image 2026-06-20 at 12.46.55 AM (1).jpeg",
  "WhatsApp Image 2026-06-20 at 12.46.55 AM (2).jpeg",
  "WhatsApp Image 2026-06-20 at 12.46.55 AM (3).jpeg",
  "WhatsApp Image 2026-06-20 at 12.46.55 AM.jpeg",
  "WhatsApp Image 2026-06-20 at 12.46.56 AM (1).jpeg",
  "WhatsApp Image 2026-06-20 at 12.46.56 AM.jpeg",
  "WhatsApp Image 2026-06-20 at 12.46.57 AM (1).jpeg",
  "WhatsApp Image 2026-06-20 at 12.46.57 AM (2).jpeg",
  "WhatsApp Image 2026-06-20 at 12.46.57 AM.jpeg",
  "WhatsApp Image 2026-06-20 at 12.46.58 AM (1).jpeg",
  "WhatsApp Image 2026-06-20 at 12.46.58 AM (2).jpeg",
  "WhatsApp Image 2026-06-20 at 12.46.58 AM (3).jpeg",
  "WhatsApp Image 2026-06-20 at 12.46.58 AM.jpeg",
  "WhatsApp Image 2026-06-20 at 12.46.59 AM (1).jpeg",
  "WhatsApp Image 2026-06-20 at 12.46.59 AM (2).jpeg",
  "WhatsApp Image 2026-06-20 at 12.46.59 AM (3).jpeg",
  "WhatsApp Image 2026-06-20 at 12.46.59 AM.jpeg",
  "WhatsApp Image 2026-06-20 at 12.47.00 AM (1).jpeg",
  "WhatsApp Image 2026-06-20 at 12.47.00 AM (2).jpeg",
  "WhatsApp Image 2026-06-20 at 12.47.00 AM.jpeg",
  "WhatsApp Image 2026-06-20 at 12.47.01 AM (1).jpeg",
  "WhatsApp Image 2026-06-20 at 12.47.01 AM (2).jpeg",
  "WhatsApp Image 2026-06-20 at 12.47.01 AM.jpeg",
  "WhatsApp Image 2026-06-20 at 12.47.02 AM (1).jpeg",
  "WhatsApp Image 2026-06-20 at 12.47.02 AM (2).jpeg",
  "WhatsApp Image 2026-06-20 at 12.47.02 AM.jpeg",
  "WhatsApp Image 2026-06-20 at 12.47.03 AM (1).jpeg",
  "WhatsApp Image 2026-06-20 at 12.47.03 AM (2).jpeg",
  "WhatsApp Image 2026-06-20 at 12.47.03 AM (3).jpeg",
  "WhatsApp Image 2026-06-20 at 12.47.03 AM.jpeg",
  "WhatsApp Image 2026-06-20 at 12.47.04 AM (1).jpeg",
  "WhatsApp Image 2026-06-20 at 12.47.04 AM (2).jpeg",
  "WhatsApp Image 2026-06-20 at 12.47.04 AM.jpeg",
  "WhatsApp Image 2026-06-20 at 12.47.05 AM (1).jpeg",
  "WhatsApp Image 2026-06-20 at 12.47.05 AM.jpeg"
];

function renderSuccessStories() {
  const track = document.getElementById("successStoriesTrack");
  if (!track) return;

  const imagesHtml = SUCCESS_STORIES.map(img => `
    <div class="success-story-card">
      <img src="Logos/Success Stories/${encodeURIComponent(img)}" alt="Success Story" loading="eager" />
    </div>
  `).join("");

  // Populate two identical sets to ensure seamless infinite scrolling loop
  track.innerHTML = imagesHtml + imagesHtml;
}

document.getElementById("closeCourseModalBtn").onclick = closeCourseDetails;
document.getElementById("closeRegisterModalBtn").onclick = closeRegisterModal;
document.getElementById("cancelRegistrationBtn").onclick = closeRegisterModal;
document.getElementById("closeSuccessModalBtn").onclick = closeSuccessModal;
registerForm.addEventListener("submit", submitRegistration);

[courseDetailsModal, registerModal, successModal].forEach((modal) => {
  modal.addEventListener("click", (event) => {
    if (event.target === modal) {
      modal.classList.add("hidden");
    }
  });
});

renderCourses();
renderSkillTree();
renderSuccessStories();

// Mascot Dynamic Coordinate Positioning helper
function updateMascotPosition() {
  // Statically positioned on the right of the main heading panel
}

// Trigger transition jump slide
function transitionMascot(inGame) {
  const jumper = document.getElementById("mascotJumper");
  if (!jumper) return;
  
  // Hop jump landing effect
  jumper.classList.remove("mascot-hop");
  void jumper.offsetWidth;
  jumper.classList.add("mascot-hop");
  
  if (window.mascotShowSpeech) {
    if (inGame) {
      window.mascotShowSpeech("Let's build your skill tree! Select your skills! 🎮", "happy");
    } else {
      window.mascotShowSpeech("Good luck! Let's find your course! 🤖", "neutral");
    }
  }
}

// Re-position mascot dynamically on window resize
window.addEventListener("resize", updateMascotPosition);

const resetSkillsBtn = document.getElementById("resetSkillsBtn");
if (resetSkillsBtn) {
  resetSkillsBtn.addEventListener("click", () => {
    selectedSkills.clear();
    renderSkillTree();
    renderCourses();
    if (window.mascotShowSpeech) {
      window.mascotShowSpeech("Cleared selected skills! Ready to try again? 🔄", "surprised");
    }
  });
}

const toggleGamePanelBtn = document.getElementById("toggleGamePanelBtn");
const skillTreeSection = document.getElementById("skillTreeSection");

if (toggleGamePanelBtn && skillTreeSection) {
  toggleGamePanelBtn.addEventListener("click", () => {
    const isOpening = skillTreeSection.classList.contains("hidden");
    
    skillTreeSection.classList.toggle("hidden");
    
    if (isOpening) {
      transitionMascot(true);
    } else {
      transitionMascot(false);
    }
  });
}

const closeSkillTreeBtn = document.getElementById("closeSkillTreeBtn");
if (closeSkillTreeBtn && skillTreeSection) {
  closeSkillTreeBtn.addEventListener("click", () => {
    skillTreeSection.classList.add("hidden");
    transitionMascot(false);
  });
}
