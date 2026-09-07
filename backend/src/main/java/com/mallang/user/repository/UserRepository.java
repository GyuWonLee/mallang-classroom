package com.mallang.user.repository;

import com.mallang.user.entity.User;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.Optional;

public interface UserRepository extends JpaRepository<User, Long> {

    Optional<User> findByUsername(String username);

    // username 존재 검사에는 아래 IncludingDeleted 를 쓴다. @SQLRestriction 이 걸리는
    // existsByUsername 은 삭제된 계정을 못 봐서 UNIQUE 위반(500)으로 이어지므로 두지 않는다.

    // 학생 아이디 번호 계산용 ({alias}01, {alias}02 ...).
    // DB UNIQUE는 soft delete된 행도 포함하므로, @SQLRestriction이 걸리는 JPA 쿼리 대신
    // 네이티브로 삭제된 계정까지 세어 번호 재사용(→ UNIQUE 충돌)을 막는다.
    @Query(value = "SELECT count(*) FROM users WHERE username LIKE :prefix || '%'",
            nativeQuery = true)
    long countByUsernamePrefixIncludingDeleted(@Param("prefix") String prefix);

    @Query(value = "SELECT EXISTS(SELECT 1 FROM users WHERE username = :username)",
            nativeQuery = true)
    boolean existsByUsernameIncludingDeleted(@Param("username") String username);
}
