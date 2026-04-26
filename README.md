basic  info
ai.py -> ai calls (azure, gemini etc)
prompts.py -> all prompts
logger.py -> reusable logger
db.py -> db connection pooler
main.py -> server entry point

routers -> diff routers, /session, /profile...
services -> helper files, would run agent loop here
tests -> any tests

tables i created:
actual sessions:
CREATE TABLE sessions (
  id BIGSERIAL PRIMARY KEY,  
  user_id BIGINT,
  title VARCHAR(255),  
  mode VARCHAR(10) NOT NULL DEFAULT 'research', --research or plan or wtv
  created_at TIMESTAMPZ DEFAULT now(),
  updated_at TIMESTAMPZ DEFAULT now()
);

nodes, belong to session with details on each node:
CREATE TABLE nodes (
  id BIGSERIAL PRIMARY KEY,
  session_id BIGINT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  topic VARCHAR(255) NOT NULL,
  summary TEXT,
  details TEXT,
  subtopics JSONB,
  depth INT DEFAULT 0, --like how deep it is from the main node
  created_at TIMESTAMPZ DEFAULT now(),
  updated_at TIMESTAMPZ DEFAULT now()
);

connections between nodes: 
CREATE TABLE node_links (
  id BIGSERIAL PRIMARY KEY,
  session_id BIGINT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  parent_id BIGINT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  child_id BIGINT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  created_at TIMESTAMPZ DEFAULT now()
);

chat history:
CREATE TABLE messages ( 
  id BIGSERIAL PRIMARY KEY,
  session_id BIGINT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  role VARCHAR(10) NOT NULL, -- user or chatbot
  content TEXT NOT NULL,
  created_at TIMESTAMPZ DEFAULT now()
);