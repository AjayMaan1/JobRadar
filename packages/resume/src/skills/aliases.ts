/**
 * Skill vocabulary: canonical name → aliases. Used by JD requirement extraction, resume evidence search,
 * profile seeding and the feed quick-match. Matching is case-insensitive unless an alias is marked with a
 * leading "=" (exact case — for short/ambiguous tokens like "Go", "Spring", "Flux").
 *
 * Grow this list from real JDs; keep canonical names human-readable (they are shown in the UI).
 */
export type SkillCategory = 'language' | 'framework' | 'cloud' | 'data' | 'devops' | 'tooling' | 'practice' | 'domain' | 'mobile' | 'testing' | 'security' | 'ai'

export interface SkillEntry {
  canonical: string
  category: SkillCategory
  aliases: string[]
}

const L = (canonical: string, category: SkillCategory, ...aliases: string[]): SkillEntry => ({ canonical, category, aliases })

export const SKILLS: SkillEntry[] = [
  // languages
  L('Java', 'language', 'java'),
  L('Go', 'language', '=Go', 'golang', '=GoLang'),
  L('Python', 'language', 'python', 'python3'),
  L('TypeScript', 'language', 'typescript', '=TS'),
  L('JavaScript', 'language', 'javascript', 'ecmascript', '=JS', 'es6', 'es2015+'),
  L('C++', 'language', 'c++', 'cpp'),
  L('C#', 'language', 'c#', 'csharp', 'c-sharp'),
  L('Rust', 'language', 'rust'),
  L('Kotlin', 'language', 'kotlin'),
  L('Scala', 'language', 'scala'),
  L('Ruby', 'language', 'ruby'),
  L('PHP', 'language', 'php'),
  L('Swift', 'language', 'swift'),
  L('Objective-C', 'language', 'objective-c', 'objective c', 'objc'),
  L('Elixir', 'language', 'elixir'),
  L('Erlang', 'language', 'erlang'),
  L('Haskell', 'language', 'haskell'),
  L('Clojure', 'language', 'clojure'),
  L('Dart', 'language', 'dart'),
  L('SQL', 'language', 'sql'),
  L('Bash', 'language', 'bash', 'shell scripting', 'shell script'),
  L('Perl', 'language', 'perl'),
  L('R', 'language', '=R language', 'r programming'),
  L('MATLAB', 'language', 'matlab'),
  L('Solidity', 'language', 'solidity'),

  // backend frameworks
  L('Node.js', 'framework', 'node.js', 'nodejs', 'node js', '=Node'),
  L('Express', 'framework', 'express.js', 'expressjs', '=Express'),
  L('NestJS', 'framework', 'nestjs', 'nest.js'),
  L('Fastify', 'framework', 'fastify'),
  L('Spring Boot', 'framework', 'spring boot', 'springboot'),
  L('Spring', 'framework', '=Spring', 'spring framework', 'spring mvc', 'spring cloud'),
  L('Django', 'framework', 'django'),
  L('Flask', 'framework', 'flask'),
  L('FastAPI', 'framework', 'fastapi'),
  L('Ruby on Rails', 'framework', 'rails', 'ruby on rails'),
  L('Laravel', 'framework', 'laravel'),
  L('.NET', 'framework', '.net', 'dotnet', '.net core', 'asp.net'),
  L('Gin', 'framework', '=Gin'),
  L('gRPC', 'framework', 'grpc'),
  L('GraphQL', 'framework', 'graphql'),
  L('REST APIs', 'framework', 'rest', 'restful', 'rest api', 'rest apis', 'restful apis', 'restful services'),
  L('WebSockets', 'framework', 'websocket', 'websockets'),
  L('OpenAPI', 'framework', 'openapi', 'swagger'),
  L('Protocol Buffers', 'framework', 'protobuf', 'protocol buffers'),

  // frontend
  L('React', 'framework', 'react', 'react.js', 'reactjs'),
  L('Next.js', 'framework', 'next.js', 'nextjs'),
  L('Vue.js', 'framework', 'vue', 'vue.js', 'vuejs', 'nuxt'),
  L('Angular', 'framework', 'angular', 'angularjs'),
  L('Svelte', 'framework', 'svelte', 'sveltekit'),
  L('Redux', 'framework', 'redux'),
  L('HTML', 'framework', 'html', 'html5'),
  L('CSS', 'framework', 'css', 'css3', 'scss', 'sass'),
  L('Tailwind CSS', 'framework', 'tailwind', 'tailwindcss'),
  L('Webpack', 'tooling', 'webpack'),
  L('Vite', 'tooling', 'vite'),
  L('Storybook', 'tooling', 'storybook'),

  // mobile
  L('React Native', 'mobile', 'react native', 'react-native'),
  L('Flutter', 'mobile', 'flutter'),
  L('Android', 'mobile', 'android'),
  L('iOS', 'mobile', 'ios'),
  L('SwiftUI', 'mobile', 'swiftui'),

  // cloud
  L('AWS', 'cloud', 'aws', 'amazon web services'),
  L('GCP', 'cloud', 'gcp', 'google cloud', 'google cloud platform'),
  L('Azure', 'cloud', 'azure', 'microsoft azure'),
  L('AWS Lambda', 'cloud', 'lambda', 'aws lambda'),
  L('Amazon S3', 'cloud', 's3', 'amazon s3'),
  L('Amazon EC2', 'cloud', 'ec2'),
  L('Amazon ECS', 'cloud', 'ecs'),
  L('Amazon EKS', 'cloud', 'eks'),
  L('Amazon RDS', 'cloud', 'rds'),
  L('Amazon DynamoDB', 'cloud', 'dynamodb', 'dynamo db'),
  L('Amazon SQS', 'cloud', 'sqs'),
  L('Amazon SNS', 'cloud', 'sns'),
  L('Amazon Kinesis', 'cloud', 'kinesis'),
  L('CloudFormation', 'cloud', 'cloudformation'),
  L('Google Kubernetes Engine', 'cloud', 'gke'),
  L('BigQuery', 'cloud', 'bigquery'),
  L('Cloudflare', 'cloud', 'cloudflare', 'cloudflare workers'),
  L('Vercel', 'cloud', 'vercel'),
  L('Serverless', 'cloud', 'serverless'),

  // devops / infra
  L('Kubernetes', 'devops', 'kubernetes', 'k8s'),
  L('Docker', 'devops', 'docker', 'containers', 'containerization', 'containerisation'),
  L('Helm', 'devops', 'helm'),
  L('Terraform', 'devops', 'terraform'),
  L('Pulumi', 'devops', 'pulumi'),
  L('Ansible', 'devops', 'ansible'),
  L('Linux', 'devops', 'linux', 'unix'),
  L('Nginx', 'devops', 'nginx'),
  L('CI/CD', 'devops', 'ci/cd', 'ci cd', 'continuous integration', 'continuous delivery', 'continuous deployment'),
  L('GitHub Actions', 'devops', 'github actions'),
  L('GitLab CI', 'devops', 'gitlab ci', 'gitlab ci/cd'),
  L('Jenkins', 'devops', 'jenkins'),
  L('ArgoCD', 'devops', 'argocd', 'argo cd'),
  L('Prometheus', 'devops', 'prometheus'),
  L('Grafana', 'devops', 'grafana'),
  L('Datadog', 'devops', 'datadog'),
  L('OpenTelemetry', 'devops', 'opentelemetry', 'otel'),
  L('ELK Stack', 'devops', 'elk', 'elk stack', 'logstash', 'kibana'),
  L('Observability', 'practice', 'observability', 'monitoring', 'alerting'),
  L('SRE', 'practice', 'sre', 'site reliability'),
  L('Infrastructure as Code', 'practice', 'infrastructure as code', 'iac'),
  L('Git', 'tooling', 'git'),

  // data stores & messaging
  L('PostgreSQL', 'data', 'postgresql', 'postgres', 'psql'),
  L('MySQL', 'data', 'mysql', 'mariadb'),
  L('MongoDB', 'data', 'mongodb', 'mongo'),
  L('Redis', 'data', 'redis'),
  L('Elasticsearch', 'data', 'elasticsearch', 'opensearch', 'elastic search'),
  L('Cassandra', 'data', 'cassandra'),
  L('Kafka', 'data', 'kafka', 'apache kafka'),
  L('RabbitMQ', 'data', 'rabbitmq'),
  L('SQLite', 'data', 'sqlite'),
  L('Neo4j', 'data', 'neo4j'),
  L('Snowflake', 'data', 'snowflake'),
  L('ClickHouse', 'data', 'clickhouse'),
  L('Apache Spark', 'data', 'spark', 'pyspark', 'apache spark'),
  L('Apache Airflow', 'data', 'airflow'),
  L('dbt', 'data', '=dbt'),
  L('Hadoop', 'data', 'hadoop'),
  L('Apache Flink', 'data', 'flink'),
  L('Databricks', 'data', 'databricks'),
  L('Pandas', 'data', 'pandas'),
  L('NumPy', 'data', 'numpy'),
  L('ETL', 'data', 'etl', 'elt', 'data pipelines', 'data pipeline'),
  L('Data Warehousing', 'data', 'data warehouse', 'data warehousing'),
  L('Data Modeling', 'data', 'data modeling', 'data modelling'),
  L('Prisma', 'data', 'prisma'),
  L('Hibernate', 'data', 'hibernate', 'jpa'),
  L('Event-Driven Architecture', 'practice', 'event-driven', 'event driven', 'event sourcing', 'cqrs'),
  L('Message Queues', 'data', 'message queue', 'message queues', 'pub/sub', 'pubsub'),

  // AI / ML
  L('Machine Learning', 'ai', 'machine learning', '=ML'),
  L('Deep Learning', 'ai', 'deep learning', 'neural networks'),
  L('PyTorch', 'ai', 'pytorch'),
  L('TensorFlow', 'ai', 'tensorflow'),
  L('scikit-learn', 'ai', 'scikit-learn', 'sklearn', 'scikit learn'),
  L('LLMs', 'ai', 'llm', 'llms', 'large language models', 'large language model'),
  L('LangChain', 'ai', 'langchain'),
  L('RAG', 'ai', 'rag', 'retrieval-augmented generation', 'retrieval augmented generation'),
  L('Vector Databases', 'ai', 'vector database', 'vector db', 'pinecone', 'weaviate', 'pgvector'),
  L('NLP', 'ai', 'nlp', 'natural language processing'),
  L('Computer Vision', 'ai', 'computer vision'),
  L('MLOps', 'ai', 'mlops'),
  L('Hugging Face', 'ai', 'hugging face', 'huggingface', 'transformers'),
  L('OpenAI API', 'ai', 'openai', 'gpt-4', 'gpt'),
  L('Prompt Engineering', 'ai', 'prompt engineering'),

  // testing
  L('Unit Testing', 'testing', 'unit testing', 'unit tests', 'tdd', 'test-driven'),
  L('Jest', 'testing', 'jest'),
  L('Cypress', 'testing', 'cypress'),
  L('Playwright', 'testing', 'playwright'),
  L('Selenium', 'testing', 'selenium'),
  L('JUnit', 'testing', 'junit'),
  L('pytest', 'testing', 'pytest'),
  L('Vitest', 'testing', 'vitest'),

  // security
  L('OAuth', 'security', 'oauth', 'oauth2', 'oauth 2.0', 'openid connect', 'oidc'),
  L('Application Security', 'security', 'appsec', 'application security', 'owasp'),
  L('Penetration Testing', 'security', 'penetration testing', 'pentest', 'pentesting'),
  L('Cryptography', 'security', 'cryptography', 'encryption'),
  L('IAM', 'security', 'iam', 'identity and access management'),
  L('SOC 2', 'security', 'soc 2', 'soc2'),

  // practices / architecture
  L('Microservices', 'practice', 'microservices', 'microservice', 'micro-services'),
  L('Distributed Systems', 'practice', 'distributed systems', 'distributed system'),
  L('System Design', 'practice', 'system design', 'systems design', 'architecture design'),
  L('Agile', 'practice', 'agile', 'scrum', 'kanban'),
  L('Code Review', 'practice', 'code review', 'code reviews'),
  L('Mentoring', 'practice', 'mentor', 'mentoring', 'mentorship', 'mentored', 'coaching'),
  L('Technical Leadership', 'practice', 'tech lead', 'technical leadership', 'technical lead', 'team lead'),
  L('Performance Optimization', 'practice', 'performance optimization', 'performance optimisation', 'performance tuning', 'latency'),
  L('Scalability', 'practice', 'scalability', 'scalable systems', 'high availability', 'high-availability'),
  L('Domain-Driven Design', 'practice', 'domain-driven design', 'ddd'),
  L('Design Patterns', 'practice', 'design patterns'),
  L('Object-Oriented Programming', 'practice', 'oop', 'object-oriented', 'object oriented'),
  L('Functional Programming', 'practice', 'functional programming'),
  L('Concurrency', 'practice', 'concurrency', 'multithreading', 'multi-threading', 'asynchronous programming'),
  L('Data Structures & Algorithms', 'practice', 'data structures', 'algorithms'),
  L('Clean Code', 'practice', 'clean code', 'solid principles'),
  L('Product Thinking', 'practice', 'product thinking', 'product sense', 'product-minded'),
  L('Cross-functional Collaboration', 'practice', 'cross-functional', 'cross functional', 'stakeholder management'),
  L('Communication', 'practice', 'communication skills', 'written communication', 'verbal communication'),

  // domains
  L('FinTech', 'domain', 'fintech', 'payments', 'banking'),
  L('E-commerce', 'domain', 'e-commerce', 'ecommerce'),
  L('HealthTech', 'domain', 'healthcare', 'healthtech', 'hipaa'),
  L('SaaS', 'domain', 'saas', 'b2b saas'),
  L('AdTech', 'domain', 'adtech', 'ad tech'),
  L('Blockchain', 'domain', 'blockchain', 'web3', 'smart contracts', 'defi'),
  L('Gaming', 'domain', 'game development', 'gaming', 'unity', 'unreal'),
  L('IoT', 'domain', 'iot', 'embedded systems', 'embedded'),
]

interface Compiled {
  entry: SkillEntry
  regexes: RegExp[]
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Boundary that also works for tokens starting/ending with + # . (C++, C#, .NET, Node.js). */
function aliasRegex(alias: string): RegExp {
  const exact = alias.startsWith('=')
  const raw = exact ? alias.slice(1) : alias
  const body = escapeRe(raw).replace(/\\ /g, '[\\s-]+')
  const pattern = `(?<![A-Za-z0-9_+#])${body}(?![A-Za-z0-9_+#])`
  return new RegExp(pattern, exact ? 'g' : 'gi')
}

let compiled: Compiled[] | null = null
function getCompiled(): Compiled[] {
  if (!compiled) compiled = SKILLS.map((entry) => ({ entry, regexes: entry.aliases.map(aliasRegex) }))
  return compiled
}

const byLower = new Map<string, SkillEntry>()
for (const e of SKILLS) {
  byLower.set(e.canonical.toLowerCase(), e)
  for (const a of e.aliases) byLower.set(a.replace(/^=/, '').toLowerCase(), e)
}

/** Map any spelling to the canonical name; unknown skills are returned trimmed as-is. */
export function canonicalizeSkill(name: string): string {
  const k = name.trim().toLowerCase()
  return byLower.get(k)?.canonical ?? name.trim()
}

export function skillEntry(canonical: string): SkillEntry | undefined {
  return byLower.get(canonical.toLowerCase())
}

export interface SkillHit {
  canonical: string
  category: SkillCategory
  count: number
  /** Up to 3 short context snippets around matches. */
  snippets: string[]
}

/** Find every known skill mentioned in a text, with counts and evidence snippets. */
export function findSkills(text: string, opts: { snippets?: boolean; maxSnippets?: number } = {}): SkillHit[] {
  if (!text) return []
  const out: SkillHit[] = []
  const maxSnips = opts.maxSnippets ?? 3
  for (const { entry, regexes } of getCompiled()) {
    let count = 0
    const snippets: string[] = []
    for (const re of regexes) {
      re.lastIndex = 0
      let m: RegExpExecArray | null
      while ((m = re.exec(text))) {
        count++
        if (opts.snippets !== false && snippets.length < maxSnips) {
          const s = Math.max(0, m.index - 50)
          const e = Math.min(text.length, m.index + m[0].length + 50)
          snippets.push(text.slice(s, e).replace(/\s+/g, ' ').trim())
        }
        if (m[0].length === 0) re.lastIndex++
      }
    }
    if (count) out.push({ canonical: entry.canonical, category: entry.category, count, snippets })
  }
  return out
}

/** Does the text mention this canonical skill (any alias)? */
export function mentionsSkill(text: string, canonical: string): number {
  const e = skillEntry(canonical)
  if (!e) {
    // unknown skill: plain case-insensitive word match
    const re = new RegExp(`(?<![A-Za-z0-9_+#])${escapeRe(canonical)}(?![A-Za-z0-9_+#])`, 'gi')
    return (text.match(re) ?? []).length
  }
  const c = getCompiled().find((x) => x.entry === e)!
  let n = 0
  for (const re of c.regexes) {
    re.lastIndex = 0
    n += (text.match(re) ?? []).length
  }
  return n
}
