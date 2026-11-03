export const RANKING_CONFIG = {
  targetSkills: [
    'Java', 'Go', 'Golang', 'Node.js', 'NodeJS', 'Python', 'TypeScript', 'JavaScript',
    'AWS', 'React', 'Kubernetes', 'K8s', 'FastAPI', 'Spring', 'Spring Boot',
    'Kafka', 'PostgreSQL', 'Docker', 'Terraform', 'PyTorch', 'LangChain',
    'Next.js', 'GraphQL', 'Redis', 'Elasticsearch', 'Microservices',
    'GCP', 'Azure', 'CI/CD', 'gRPC', 'REST', 'API',
  ],

  // INR annual thresholds (in lakhs)
  salaryBands: [
    { minInrLakhs: 90, pts: 30 },
    { minInrLakhs: 85, pts: 25 },
    { minInrLakhs: 75, pts: 20 },
    { minInrLakhs: 65, pts: 15 },
    { minInrLakhs: 55, pts: 10 },
  ],

  preferredCategories: ['Backend', 'Full Stack', 'DevOps', 'AI/ML', 'Data'],

  preferredSeniority: ['senior', 'lead', 'staff', 'principal'],

}
