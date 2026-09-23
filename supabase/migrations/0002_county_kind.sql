-- County scoping and organisation kind (church vs. a church-founded ministry
-- or partner nonprofit) so a county-focused deployment can filter its view.
alter table bc_churches add column if not exists county text;
alter table bc_churches add column if not exists kind text not null default 'church'; -- church | ministry
create index if not exists bc_churches_county on bc_churches (county);
