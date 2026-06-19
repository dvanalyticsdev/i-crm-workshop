export const AED_EXCHANGE_RATE_INR = 23.35;

function withGst(basePriceInr) {
  return Math.round(basePriceInr * 1.18);
}

function toAed(amountInr) {
  return Math.round(amountInr / AED_EXCHANGE_RATE_INR);
}

function buildPrice(basePriceInr, customAed = null) {
  const totalInr = withGst(basePriceInr);
  return {
    baseInr: basePriceInr,
    totalInr,
    totalAed: customAed !== null ? customAed : toAed(totalInr)
  };
}

function buildSection(title, paragraphs = [], bullets = []) {
  return { title, paragraphs, bullets };
}

export const PUBLIC_COURSES = [
  {
    id: "apids",
    shortName: "APIDS",
    code: "APIDS",
    poster: "Logos/APIDS.jpeg",
    name: "Advanced Program in Industrial Data Science & AI",
    duration: "6-8 Months",
    price: buildPrice(300000, 20000),
    badge: "Flagship Program",
    headline: "Build full-stack data science, machine learning, generative AI, and agentic AI skills in one career track.",
    sections: [
      buildSection("Program Overview", [
        "APIDS is a complete industry-oriented program for graduates and working professionals who want to become Data Science and AI practitioners.",
        "The program covers the journey from data management and analytics to machine learning, deep learning, generative AI, agentic AI, and cloud deployment."
      ]),
      buildSection("What You Build", [], [
        "Manage structured and unstructured data",
        "Perform advanced analysis and visual storytelling",
        "Develop machine learning and deep learning models",
        "Build LLM, generative AI, and agentic AI applications",
        "Deploy enterprise AI solutions with MLOps and LLMOps"
      ]),
      buildSection("Curriculum Structure", [
        "The curriculum is organized into four layers: Data Management, Data Analysis & Visualization, Data Mining & AI, and Cloud Deployment."
      ], [
        "SQL Server, Python, SAS, PySpark and Scala foundations",
        "Excel AI, Power BI, and Tableau for business analytics",
        "Statistics, machine learning, deep learning, GenAI, and multi-agent systems",
        "MLOps, LLMOps, AIOps, and production deployment practices"
      ]),
      buildSection("Projects and Tools", [
        "Learners work on real-world projects across banking, telecom, insurance, retail, e-commerce, and healthcare."
      ], [
        "Credit risk, churn prediction, recommendation systems, fraud detection, and patient analytics",
        "Python, TensorFlow, Scikit-learn, OpenAI APIs, LangChain, LangGraph, CrewAI, AutoGen",
        "AWS, Azure, GCP, Docker, GitHub, and cloud deployment workflows"
      ]),
      buildSection("Career Outcomes", [], [
        "Data Analyst, Reporting Analyst, Junior Data Scientist",
        "Data Scientist, Machine Learning Engineer, AI Engineer",
        "Lead Data Scientist, AI Solution Architect, Analytics Manager"
      ]),
      buildSection("Program Support", [], [
        "Instructor-led training and LMS access",
        "Assignments, case studies, industry projects, and capstone",
        "Resume support, LinkedIn optimization, mock interviews, and placement assistance"
      ])
    ]
  },
  {
    id: "apida",
    shortName: "APIDA",
    code: "APIDA",
    poster: "Logos/APIDA.jpeg",
    name: "Advanced Program in Industrial Data Analytics & AI",
    duration: "5-8 Months",
    price: buildPrice(250000, 15000),
    badge: "Analytics Focus",
    headline: "A business analytics track focused on BI, dashboards, statistics, machine learning, and decision-ready reporting.",
    sections: [
      buildSection("Program Overview", [
        "APIDA is built for learners who want strong analytics, business intelligence, and AI-driven decision-making capabilities without going deep into advanced GenAI and agentic system development.",
        "It combines data management, visualization, statistics, machine learning, and model deployment into a practical business-focused program."
      ]),
      buildSection("What You Learn", [], [
        "Manage and process business data at scale",
        "Build dashboards and executive reporting views",
        "Apply statistics and predictive modeling to business problems",
        "Deploy machine learning models using MLOps practices"
      ]),
      buildSection("Curriculum Structure", [
        "The program flows through Data Management, Data Analysis & Visualization, Data Mining & AI, and Cloud Deployment."
      ], [
        "SQL Server, Python, SAS, PySpark, and Scala for data foundations",
        "Excel AI, Power BI, and Tableau for reporting and storytelling",
        "Statistics, regression, classification, clustering, forecasting, and fraud detection",
        "Git, deployment pipelines, model monitoring, and enterprise ML workflows"
      ]),
      buildSection("Projects and Capstone", [], [
        "Credit risk modeling, revenue analytics, churn prediction, demand forecasting, and healthcare analytics",
        "End-to-end capstone covering business problem definition, transformation, dashboarding, model building, deployment, and final presentation"
      ]),
      buildSection("Career Outcomes", [], [
        "Data Analyst, BI Analyst, MIS Analyst, Reporting Analyst",
        "Machine Learning Analyst, Associate Data Scientist, Analytics Consultant",
        "Credit Risk Analyst, Marketing Analyst, Retail Analytics Analyst"
      ]),
      buildSection("Program Support", [], [
        "Live sessions, recordings, assignments, and industry case studies",
        "Real-time projects and capstone project",
        "Resume building, LinkedIn optimization, mock interviews, placement assistance"
      ])
    ]
  },
  {
    id: "advanced-aiml-genai-agentic",
    shortName: "Advanced AIML",
    code: "AIML + GenAI",
    poster: "Logos/Advance-AIML-GenAI-AgenticAI.jpeg",
    name: "Advanced AIML with Gen AI & Agentic AI",
    duration: "4 Months",
    price: buildPrice(220000, 15000),
    badge: "AI Builder",
    headline: "An advanced AI program that bridges Python, SQL, ML, deep learning, GenAI, RAG, and agentic workflows.",
    sections: [
      buildSection("Program Overview", [
        "This curriculum is structured as a complete AI journey moving from data and programming foundations into machine learning, deep learning, generative AI, and agentic AI.",
        "It is designed for learners who want production-oriented AI capability rather than only theoretical coverage."
      ]),
      buildSection("Bridge Foundation", [], [
        "Python for data science, NumPy, Pandas, and data visualization",
        "SQL for data science including joins, CTEs, window functions, and EDA with SQL",
        "Basic statistics and probability foundations"
      ]),
      buildSection("Core AIML Stack", [], [
        "Inferential statistics, hypothesis testing, regression, and model evaluation",
        "Machine learning across regression, classification, clustering, anomaly detection, feature engineering, tuning, and pipelines",
        "Deep learning foundations, NLP workflows, RNNs, LSTMs, transformers, and model interpretation"
      ]),
      buildSection("Capstones and Applied Work", [], [
        "Retail sales EDA dashboard capstone",
        "Customer churn prediction pipeline with SMOTE, ROC-AUC, Precision-Recall, and SHAP",
        "Deployment-ready AI workflows using FastAPI and practical business use cases"
      ]),
      buildSection("Ideal For", [], [
        "Learners building toward Data Scientist, ML Engineer, or Applied AI roles",
        "Professionals who want stronger foundations before production GenAI and agentic system work"
      ]),
      buildSection("Program Support", [], [
        "Live sessions, recordings, assignments, and capstone project",
        "Resume building, LinkedIn optimization, mock interviews, placement assistance"
      ])
    ]
  },
  {
    id: "master-genai-agentic",
    shortName: "GenAI Master",
    code: "GenAI Master",
    poster: "Logos/Master-GenAI-AgenticAI.jpeg",
    name: "Master Program in Gen AI & Agentic AI",
    duration: "2 Months",
    price: buildPrice(120000, 12000),
    badge: "Advanced Track",
    headline: "A production-focused GenAI and Agentic AI program covering transformers, RAG, fine-tuning, evaluation, and multi-agent systems.",
    sections: [
      buildSection("Program Overview", [
        "This master program builds from Python and deep learning foundations into a full generative AI and agentic AI stack.",
        "The curriculum emphasizes production use cases, evaluation, orchestration, observability, and real system building."
      ]),
      buildSection("Foundations and Deep Learning", [], [
        "Python for AI development, API integration, Pandas, and visualization",
        "Neural networks, NLP, transformer architecture, BERT, GPT, T5, and Hugging Face workflows",
        "Sentiment analysis API capstone with FastAPI and Docker"
      ]),
      buildSection("Generative AI Stack", [], [
        "LLM concepts, prompting, structured outputs, and prompt safety",
        "RAG architecture, embeddings, vector databases, re-ranking, graph RAG, and RAG evaluation",
        "Multimodal AI, fine-tuning, LoRA/QLoRA, safety guardrails, and testing frameworks"
      ]),
      buildSection("Agentic AI and Production Systems", [], [
        "Agent foundations, reasoning loops, memory systems, and state management",
        "LangChain, LangGraph, AutoGen, CrewAI, and multi-agent patterns",
        "Real-time agents, observability, LangSmith, Helicone, Grafana, and Model Context Protocol"
      ]),
      buildSection("Capstones and Career Fit", [], [
        "Document intelligence RAG system with citations and evaluation",
        "Designed for professionals moving into GenAI engineer, AI architect, or agentic AI product roles"
      ])
    ]
  },
  {
    id: "data-analytics-specialist",
    shortName: "DAS",
    code: "DAS",
    poster: "Logos/DAS.jpeg",
    name: "Data Analytics Specialist",
    duration: "3-4 Months",
    price: buildPrice(150000, 10000),
    badge: "Career Starter",
    headline: "A practical analytics program for SQL, Python, Excel AI, Power BI, dashboards, reporting automation, and BI careers.",
    sections: [
      buildSection("Program Overview", [
        "The Data Analytics Specialist program is a practical business analytics track built for graduates and working professionals entering analytics and BI careers.",
        "It focuses on data management, reporting automation, data visualization, dashboards, and business decision support."
      ]),
      buildSection("Core Learning Areas", [], [
        "SQL Server for querying, reporting, CTEs, window functions, and KPI preparation",
        "Python for cleaning, transformation, automation, file processing, and reporting support",
        "Excel AI and Power BI for dashboards, executive reporting, and business intelligence"
      ]),
      buildSection("Industry Projects", [], [
        "Loan portfolio and credit card usage dashboards",
        "Sales performance, product performance, customer purchase behavior, and revenue analytics",
        "Telecom retention analysis and reporting dashboards"
      ]),
      buildSection("Career Outcomes", [], [
        "Data Analyst, MIS Analyst, Reporting Analyst, Business Analyst",
        "Senior Data Analyst, BI Analyst, Analytics Consultant, Reporting Lead",
        "Banking, Retail, Marketing, Financial, and Telecom Analyst roles"
      ]),
      buildSection("Program Deliverables", [], [
        "Live instructor-led sessions, LMS access, and recorded sessions",
        "Assignments, assessments, industry case studies, and real-time projects",
        "Dashboard portfolio, resume support, LinkedIn optimization, and mock interviews"
      ])
    ]
  },
  {
    id: "apcs",
    shortName: "APCS",
    code: "APCS",
    poster: "Logos/APCS.jpeg",
    name: "Advanced Program in Cybersecurity & Forensics",
    duration: "3-4 Months",
    price: buildPrice(70000, 10000),
    badge: "Security Track",
    headline: "A cybersecurity and digital forensics program built around bridge learning, ethical hacking, incident response, and hands-on labs.",
    sections: [
      buildSection("Program Overview", [
        "APCS is positioned as an advanced program in Cybersecurity and Cyber Forensics with a 3-4 month immersive structure and strong practical focus.",
        "The brochure emphasizes hands-on labs, assignments, case studies, and real-world security and incident response readiness."
      ]),
      buildSection("Why This Program", [], [
        "Covers cybersecurity foundations, ethical hacking, and cyber forensics in one pathway",
        "Live training with recorded sessions, real-time industry projects, resume building, and mock interviews",
        "Open to graduates, post-graduates, masters, and PhD holders from any discipline"
      ]),
      buildSection("Learning Path", [], [
        "Cybersecurity Bridge Course - 16 hours",
        "Cybersecurity Beginner Course - 24 hours",
        "Cybersecurity Ethical Hacking - 60 hours",
        "Cyber Forensics - 80 hours"
      ]),
      buildSection("Curriculum Snapshot", [], [
        "System architecture, operating systems, networking, virtual machines, and Python basics",
        "Cybersecurity concepts, security layers, reconnaissance, PowerShell, malware and phishing analysis, defensive and offensive security techniques",
        "Ethical hacking topics including scanning, enumeration, vulnerability analysis, web security, wireless security, IoT hacking, cloud security, and cryptography",
        "Forensics topics including incident detection, chain of custody, evidence acquisition, hashing, live imaging, memory analysis, timeline creation, Windows and Linux artifacts, and DFIR"
      ]),
      buildSection("Career Support and Delivery", [], [
        "Offline and online classes, quizzes, assignments, and case studies",
        "Alumni connect, mock interviews, and certification prep",
        "Designed for learners targeting cybersecurity, ethical hacking, DFIR, and cyber defense career paths"
      ])
    ]
  }
];

export function findCourseById(courseId) {
  return PUBLIC_COURSES.find((course) => course.id === courseId) || null;
}

export function formatInr(amount) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0
  }).format(amount);
}

export function formatAed(amount) {
  return new Intl.NumberFormat("en-AE", {
    style: "currency",
    currency: "AED",
    maximumFractionDigits: 0
  }).format(amount);
}
