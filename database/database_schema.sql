create Extension if not exists vector;

create table if not exists track_features(
    id varchar(50) primary key,
    danceability float,
    energy float,
    key integer,
    loudness float,
    mode integer,
    tempo float,
    valence float,
    z_vector vector(33) not null
);

create index if not exists track_features_z_vector_idx
on track_features
using hnsw (z_vector vector_12_ops)
with (m=16,ef_construction=64);